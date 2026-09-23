# Synthetic images only; never uses personal documents.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime/staging'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$samples = @(
    @{ Name='nas-acceptance-ar.png'; Lines=@('اختبار الأرشيف العربي', 'هذه وثيقة تجريبية لفحص البحث', 'رقم الكتاب 12345'); Rtl=$true },
    @{ Name='nas-acceptance-en.png'; Lines=@('NAS Archive acceptance test', 'Document number 67890', 'Searchable English archive'); Rtl=$false }
)
foreach ($sample in $samples) {
    $bitmap = New-Object System.Drawing.Bitmap(2480,3508)
    $bitmap.SetResolution(300,300)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $font = New-Object System.Drawing.Font('Arial',22)
    $format = New-Object System.Drawing.StringFormat
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        if ($sample.Rtl) { $format.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft }
        $y = 250
        foreach ($line in $sample.Lines) {
            $rect = New-Object System.Drawing.RectangleF(200,$y,2080,200)
            $graphics.DrawString($line,$font,[System.Drawing.Brushes]::Black,$rect,$format)
            $y += 200
        }
        $bitmap.Save((Join-Path $target $sample.Name),[System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $format.Dispose(); $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    }
}
Write-Output 'Two synthetic OCR images are ready in runtime/staging; nothing has been imported.'
