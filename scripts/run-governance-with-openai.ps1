param(
  [ValidateSet("generate", "server")]
  [string]$Mode = "generate",
  [int]$Port = 5190,
  [string]$Model = "gpt-4.1"
)

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

$secureKey = Read-Host "Cole a chave OpenAI para este teste" -AsSecureString
$plainKey = (Convert-SecureStringToPlainText -SecureValue $secureKey).Trim()

try {
  $env:OPENAI_API_KEY = $plainKey
  $env:AI_DIRECT_OPENAI = "1"
  $env:OPENAI_MODEL = $Model

  if ($Mode -eq "server") {
    Write-Host "Servidor com IA real em http://localhost:$Port"
    node server.js --port $Port
  } else {
    npm run governance:generate
  }
} finally {
  Remove-Item Env:\OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\AI_DIRECT_OPENAI -ErrorAction SilentlyContinue
  Remove-Item Env:\OPENAI_MODEL -ErrorAction SilentlyContinue
  $plainKey = $null
}
