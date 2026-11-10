; The CLI ships in resources/cli. Running the app with --install-cli writes the
; per-user shim and updates HKCU\Environment\Path without elevation. The same
; code path is exposed from Settings, so a failed install is repairable.
!include "LogicLib.nsh"
!macro customInstall
  DetailPrint "Installing the vesper command line tool…"
  ExecWait '"$INSTDIR\Vesper.exe" --install-cli' $0
  ${if} $0 != 0
    DetailPrint "The vesper command could not be installed (exit $0). You can repair it from Settings → Command line."
  ${endIf}
!macroend

!macro customUnInstall
  DetailPrint "Removing the vesper command line tool…"
  ExecWait '"$INSTDIR\Vesper.exe" --uninstall-cli' $0
!macroend
