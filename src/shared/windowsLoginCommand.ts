/** PowerShell lookup failures can leave LASTEXITCODE unset or even stale. */
export function windowsLoginCommand(command: string, completionToken: string): string {
  return [
    "$lcExit = 1",
    `try { ${command}; if ($?) { $lcExit = 0 } elseif ($LASTEXITCODE -gt 0) { $lcExit = $LASTEXITCODE } } catch { Write-Host $_ -ForegroundColor Red }`,
    `Write-Host "$([char]27)]777;craftstation-login-complete=${completionToken}:$lcExit$([char]7)" -NoNewline`,
  ].join("; ");
}
