<#
.SYNOPSIS
  打包可上架的扩展 zip（仅包含运行时必需文件）。

.DESCRIPTION
  包含：manifest.json、icons/、src/、LICENSE
  排除：.git、docs/、assets/、scripts/、store/、dist/、日志与临时文件
  打包前会对文本文件做一次敏感信息扫描（本机绝对路径、邮箱、常见密钥格式），
  命中则中止打包并输出位置。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\pack-extension.ps1
#>

param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist ("rulebox-$version.zip")
$stage = Join-Path $env:TEMP ("rulebox-pack-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host "== 复制运行时文件 ==" -ForegroundColor Cyan
foreach ($item in @('manifest.json', 'LICENSE', 'icons', 'src')) {
  $src = Join-Path $root $item
  if (Test-Path $src) {
    Copy-Item $src -Destination $stage -Recurse -Force
    Write-Host "  + $item"
  } else {
    Write-Warning "  缺少 $item"
  }
}

# 兜底清理：任何 .git 痕迹、日志、数据库、压缩包都不进上架包
Get-ChildItem $stage -Recurse -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '.git*' -or $_.Name -in @('*.log', '*.bak', '*.tmp', '*.zip', '*.sqlite', '*.db', '.DS_Store', 'Thumbs.db') } |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "== 敏感信息扫描 ==" -ForegroundColor Cyan
$rules = @(
  @{ Name = '本机绝对路径'; Pattern = '[A-Za-z]:\\\\?(Users|Temp|RuleBox)' },
  @{ Name = '个人标识';     Pattern = 'EdenChen|ChangFei' },
  @{ Name = '邮箱地址';     Pattern = '[A-Za-z0-9._%+-]+@(?!example\.(com|org|net))[A-Za-z0-9.-]+\.(com|cn|net|org)' },
  @{ Name = 'OpenAI 密钥';  Pattern = 'sk-[A-Za-z0-9]{20,}' },
  @{ Name = 'GitHub Token'; Pattern = 'gh[pousr]_[A-Za-z0-9]{20,}' },
  @{ Name = 'AWS AccessKey'; Pattern = 'AKIA[0-9A-Z]{16}' },
  @{ Name = '私钥文件头';   Pattern = 'BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY' }
)
$hits = @()
$textExt = @('.js', '.json', '.html', '.css', '.md', '.txt')
foreach ($file in Get-ChildItem $stage -Recurse -File) {
  if ($textExt -notcontains $file.Extension) { continue }
  $text = Get-Content $file.FullName -Raw -Encoding UTF8
  if (-not $text) { continue }
  foreach ($rule in $rules) {
    if ($text -match $rule.Pattern) {
      $hits += ("{0}: {1}" -f $file.FullName.Substring($stage.Length + 1), $rule.Name)
    }
  }
}
if ($hits.Count -gt 0) {
  Write-Host "扫描命中，已中止打包：" -ForegroundColor Red
  $hits | ForEach-Object { Write-Host "  ! $_" -ForegroundColor Red }
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "  未发现敏感信息" -ForegroundColor Green

if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $out -CompressionLevel Optimal -Force
$files = (Get-ChildItem $stage -Recurse -File | Measure-Object).Count
$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "== 打包完成 ==" -ForegroundColor Cyan
Write-Host "  文件：dist\rulebox-$version.zip"
Write-Host "  内容：$files 个文件，$size KB"
Write-Host "  上传：Edge Partner Center / Chrome Developer Dashboard 直接选这个 zip"
