$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName System.Speech
    Add-Type -AssemblyName System.Web.Extensions
    $sourcePath = Join-Path $PSScriptRoot 'SpeechHost.cs'
    $sourceCode = [System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8)
    Add-Type -TypeDefinition $sourceCode -ReferencedAssemblies @('System.Speech', 'System.Web.Extensions')
    [InterviewSpeechHost]::Run()
} catch {
    @{ type = 'speech-error'; message = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
