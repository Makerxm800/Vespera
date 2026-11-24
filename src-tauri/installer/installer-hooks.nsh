; User-visible progress details for the standard Tauri NSIS wizard.
; The installer page exposes these DetailPrint messages under its Details control.
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Preparing the Vespera installation..."
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Vespera has been installed to: $INSTDIR"
  DetailPrint "On the Finish page, choose whether to run Vespera or create a desktop shortcut."
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Vespera from this device..."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "Vespera has been removed."
!macroend
