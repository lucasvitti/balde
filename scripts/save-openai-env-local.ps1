$ErrorActionPreference = "Stop"

function Convert-SecureStringToPlainText {
  param([securestring]$SecureValue)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

$secureKey = Read-Host "Cole a chave OpenAI para salvar em .env.local" -AsSecureString
$plainKey = (Convert-SecureStringToPlainText -SecureValue $secureKey).Trim()

try {
  $envPath = Join-Path (Get-Location) ".env.local"
  $content = @(
    "AI_DIRECT_OPENAI=1"
    "OPENAI_MODEL=gpt-4.1"
    "OPENAI_API_KEY=$plainKey"
  ) -join [Environment]::NewLine

  Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8
  Write-Host ".env.local salvo. Esse arquivo está ignorado pelo Git."
} finally {
  $plainKey = $null
}
