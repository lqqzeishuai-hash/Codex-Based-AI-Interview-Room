using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text;
using System.Web.Script.Serialization;

public static class InterviewSpeechHost {
    static readonly object Gate = new object();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static SpeechRecognitionEngine recognizer;
    static SpeechSynthesizer speaker;
    static bool recognizing;
    static bool wantListening;
    static string currentSpeechId;
    static readonly Dictionary<Prompt, string> prompts = new Dictionary<Prompt, string>();
    static void Emit(object value) { lock(Gate) { Console.Out.WriteLine(Json.Serialize(value)); Console.Out.Flush(); } }
    static string Text(Dictionary<string, object> command, string key, string fallback = "") { return command.ContainsKey(key) ? Convert.ToString(command[key]) : fallback; }
    static void EnsureRecognizer() {
        if (recognizer != null) return;
        RecognizerInfo selected = null;
        foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers()) {
            if (selected == null || info.Culture.Name == "zh-CN") selected = info;
            if (info.Culture.Name == "zh-CN") break;
        }
        if (selected == null) throw new Exception("Windows 未安装语音识别语言。请在系统语言设置中安装中文语音功能。");
        recognizer = new SpeechRecognitionEngine(selected);
        recognizer.LoadGrammar(new DictationGrammar());
        recognizer.SetInputToDefaultAudioDevice();
        recognizer.EndSilenceTimeout = TimeSpan.FromMilliseconds(700);
        recognizer.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(1100);
        recognizer.SpeechHypothesized += delegate(object sender, SpeechHypothesizedEventArgs e) { Emit(new { type = "hypothesis", text = e.Result.Text }); };
        recognizer.SpeechRecognized += delegate(object sender, SpeechRecognizedEventArgs e) { if (wantListening) Emit(new { type = "recognized", text = e.Result.Text, confidence = e.Result.Confidence }); };
        recognizer.SpeechRecognitionRejected += delegate { if (wantListening) Emit(new { type = "rejected", message = "没有听清这句话，可以继续说。" }); };
        recognizer.RecognizeCompleted += delegate(object sender, RecognizeCompletedEventArgs e) {
            recognizing = false;
            if (e.Error != null) { wantListening = false; Emit(new { type = "speech-error", message = e.Error.Message }); }
            Emit(new { type = "listening", active = false });
            if (wantListening) StartListening();
        };
    }
    static void StartListening() {
        EnsureRecognizer(); wantListening = true;
        if (!recognizing) { recognizing = true; recognizer.RecognizeAsync(RecognizeMode.Multiple); Emit(new { type = "listening", active = true }); }
    }
    static void StopListening() {
        wantListening = false;
        if (recognizer != null && recognizing) recognizer.RecognizeAsyncCancel();
        else Emit(new { type = "listening", active = false });
    }
    static void SelfTest(string filename, string id) {
        using (SpeechSynthesizer testSpeaker = new SpeechSynthesizer()) {
            testSpeaker.SelectVoiceByHints(VoiceGender.Female, VoiceAge.Adult, 0, new CultureInfo("zh-CN"));
            testSpeaker.SetOutputToWaveFile(filename); testSpeaker.Speak("请介绍一下你负责的项目");
        }
        string recognized = "";
        using (SpeechRecognitionEngine testRecognizer = new SpeechRecognitionEngine(new CultureInfo("zh-CN"))) {
            testRecognizer.LoadGrammar(new DictationGrammar()); testRecognizer.SetInputToWaveFile(filename);
            RecognitionResult result = testRecognizer.Recognize(TimeSpan.FromSeconds(10));
            if (result != null) recognized = result.Text;
        }
        Emit(new { type = "selftest", id = id, recognizedText = recognized, wavBytes = new FileInfo(filename).Length });
    }
    public static void Run() {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        speaker = new SpeechSynthesizer();
        speaker.SpeakCompleted += delegate(object sender, SpeakCompletedEventArgs e) {
            string id = null; lock (Gate) { if (prompts.ContainsKey(e.Prompt)) { id = prompts[e.Prompt]; prompts.Remove(e.Prompt); } }
            if (id != null && id == currentSpeechId && !e.Cancelled) Emit(new { type = "spoken", id = id, error = e.Error == null ? null : e.Error.Message });
        };
        var voices = new List<object>(); foreach (InstalledVoice voice in speaker.GetInstalledVoices()) if (voice.Enabled) voices.Add(new { name = voice.VoiceInfo.Name, culture = voice.VoiceInfo.Culture.Name });
        var recognizers = new List<object>(); foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers()) recognizers.Add(new { name = info.Name, culture = info.Culture.Name });
        Emit(new { type = "capabilities", voices = voices, recognizers = recognizers, local = true });
        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                var command = Json.Deserialize<Dictionary<string, object>>(line);
                string action = Text(command, "action"); string id = Text(command, "id");
                if (action == "listen") StartListening();
                else if (action == "stop-listening") StopListening();
                else if (action == "speak") {
                    StopListening(); speaker.SpeakAsyncCancelAll(); currentSpeechId = id;
                    string voice = Text(command, "voice"); if (voice.Length > 0) speaker.SelectVoice(voice);
                    int rate = command.ContainsKey("rate") ? Convert.ToInt32(command["rate"]) : 0; speaker.Rate = Math.Max(-5, Math.Min(5, rate));
                    speaker.SetOutputToDefaultAudioDevice(); Prompt prompt = speaker.SpeakAsync(Text(command, "text")); lock (Gate) { prompts[prompt] = id; }
                    Emit(new { type = "speaking", active = true, id = id });
                }
                else if (action == "stop-speaking") { currentSpeechId = null; speaker.SpeakAsyncCancelAll(); Emit(new { type = "speaking", active = false }); }
                else if (action == "selftest") SelfTest(Text(command, "path"), id);
                else if (action == "shutdown") break;
            } catch (Exception error) { Emit(new { type = "speech-error", message = error.Message }); }
        }
        StopListening(); if (recognizer != null) recognizer.Dispose(); speaker.Dispose();
    }
}
