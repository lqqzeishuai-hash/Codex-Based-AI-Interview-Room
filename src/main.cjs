const { app, BrowserWindow, ipcMain, dialog, session, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { InterviewController } = require('./core/controller.cjs');
const { NativeSpeech } = require('./core/speech.cjs');
let window, controller, speech;
let normalBounds = null;
let miniMode = false;
app.setName('AI面试室');
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(() => {
    controller = new InterviewController({ dataDirectory: process.env.AI_INTERVIEW_DATA_DIR || app.getPath('userData') });
    speech = new NativeSpeech();
    const dispatch = value => { if (window && !window.isDestroyed()) window.webContents.send('interview:event', value); };
    controller.on('event', dispatch); speech.on('event', event => dispatch({ type: 'speech', event }));
    window = new BrowserWindow({ width: 1440, height: 980, minWidth: 1060, minHeight: 760, title: 'AI面试室 · Codex', icon: path.join(__dirname, 'assets', 'icon.ico'), backgroundColor: '#f6f7fb', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false } });
    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    const rendererUrl = require('node:url').pathToFileURL(rendererPath).href;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
    const canUseCamera = (contents, permission) => contents === window.webContents && (permission === 'media' || permission === 'camera') && contents.getURL() === rendererUrl;
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(canUseCamera(contents, permission)));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => canUseCamera(contents, permission));
    const setMiniMode = enabled => {
      if (!window || window.isDestroyed()) return { enabled: false };
      const next = Boolean(enabled);
      if (next === miniMode) return { enabled: miniMode, bounds: window.getBounds() };
      if (next) {
        if (window.isMinimized()) window.restore();
        normalBounds = window.getBounds();
        const display = screen.getDisplayMatching(normalBounds);
        const workArea = display.workArea;
        const width = Math.min(560, Math.max(440, workArea.width - 32));
        const height = Math.min(420, Math.max(300, workArea.height - 32));
        window.setMinimumSize(440, 300);
        window.setBounds({ x: workArea.x + workArea.width - width - 18, y: workArea.y + workArea.height - height - 18, width, height }, true);
        window.setAlwaysOnTop(true, 'floating');
        window.setTitle('AI面试室 · 小窗');
      } else {
        window.setAlwaysOnTop(false);
        window.setMinimumSize(1060, 760);
        if (normalBounds) window.setBounds(normalBounds, true);
        window.setTitle('AI面试室 · Codex');
        normalBounds = null;
      }
      miniMode = next;
      return { enabled: miniMode, bounds: window.getBounds() };
    };
    ipcMain.handle('interview:invoke', async (event, method, params = {}) => {
      if (event.sender !== window.webContents || typeof method !== 'string') throw new Error('无效的调用来源。');
      if (method === 'window/mini') return setMiniMode(params.enabled);
      if (method === 'project/pick') {
        const result = await dialog.showOpenDialog(window, { title: '选择用于面试的项目文件夹', properties: ['openDirectory'] });
        return result.canceled ? null : result.filePaths[0];
      }
      if (method === 'report/save') {
        const report = await controller.invoke('session/export', params);
        const result = await dialog.showSaveDialog(window, { title: '导出面试记录', defaultPath: report.filename, filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (result.canceled || !result.filePath) return null;
        await fs.writeFile(result.filePath, report.markdown, 'utf8'); return { path: result.filePath };
      }
      if (method === 'speech/capabilities') return speech.start();
      if (method.startsWith('speech/')) {
        const action = method.slice(7);
        if (!['listen','stop-listening','speak','stop-speaking'].includes(action)) throw new Error('无效的语音操作。');
        return speech.command(action, params);
      }
      return controller.invoke(method, params);
    });
    window.loadFile(rendererPath);
    window.on('close', event => {
      if (controller.busy || controller.review.busy) {
        const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续使用', '退出软件'], defaultId: 0, cancelId: 0, title: '正在生成内容', message: '退出会停止当前生成，已经完成的问答、核对与答疑会保存在本机。' });
        if (choice === 0) event.preventDefault();
      }
    });
    app.on('before-quit', () => { speech.close(); controller.codex.close(); });
  });
}
app.on('window-all-closed', () => app.quit());
