param([string]$Port = 'COM3')
$ErrorActionPreference = 'Stop'
$diceSerial = [System.IO.Ports.SerialPort]::new($Port, 115200)
$diceSerial.ReadTimeout = 250
$diceSerial.NewLine = "`n"
$diceSerial.DtrEnable = $false
$diceSerial.RtsEnable = $false
$diceToken = [guid]::NewGuid().ToString()
try {
  $diceSerial.Open()
  $diceDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $diceDeadline) {
    $diceSerial.WriteLine("SESSION $diceToken")
    try {
      $diceReply = $diceSerial.ReadLine().Trim()
      if ($diceReply -eq "READY $diceToken") {
        Write-Output "PASS: $Port firmware handshake received; IMU is enabled."
        exit 0
      }
      if ($diceReply -eq 'ERROR NO_IMU') { throw 'Firmware is running but no IMU was detected.' }
    } catch [System.TimeoutException] { }
  }
  throw "No firmware handshake on $Port within 15 seconds."
} finally {
  if ($diceSerial.IsOpen) { $diceSerial.Close() }
  $diceSerial.Dispose()
}
