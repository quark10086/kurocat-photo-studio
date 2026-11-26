!macro NSIS_HOOK_PREINSTALL
  ; Fix #73 & #74: Close any running KuroCat.exe (including legacy <=v5.1.1 copies
  ; running from another folder or portable path) and eliminate "Error opening file
  ; for writing" races before NSIS writes the new binary.
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 _kurocat_kill_any_running
    ; Give an exiting in-app update process a brief grace window to close cleanly first
    StrCpy $R9 0
    _kurocat_wait_writable:
      ClearErrors
      FileOpen $R8 "$INSTDIR\${MAINBINARYNAME}.exe" a
      IfErrors _kurocat_still_locked
        FileClose $R8
        Goto _kurocat_kill_any_running
      _kurocat_still_locked:
        IntOp $R9 $R9 + 1
        IntCmp $R9 4 _kurocat_kill_any_running _kurocat_sleep_retry _kurocat_kill_any_running
      _kurocat_sleep_retry:
        Sleep 250
        Goto _kurocat_wait_writable

  _kurocat_kill_any_running:
    ; Silently close any lingering KuroCat.exe across all directories so first-time
    ; installs never leave a legacy portable/other-folder copy running alongside the new one.
    nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /IM "${MAINBINARYNAME}.exe"'
    Pop $R8 ; exit code (0 = terminated at least one process, 128 = none running)
    Pop $R7 ; captured output
    StrCmp $R8 "0" 0 _kurocat_check_target_lock
      Sleep 400

  _kurocat_check_target_lock:
    IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 _kurocat_preinstall_done
      ClearErrors
      FileOpen $R8 "$INSTDIR\${MAINBINARYNAME}.exe" a
      IfErrors _kurocat_rename_aside
        FileClose $R8
        Goto _kurocat_preinstall_done

    _kurocat_rename_aside:
      ; Windows allows renaming a mapped/locked executable in place so NSIS can write
      ; the brand-new KuroCat.exe cleanly even if AV or an MCP child still holds a handle.
      Delete "$INSTDIR\${MAINBINARYNAME}.exe.old"
      ClearErrors
      Rename "$INSTDIR\${MAINBINARYNAME}.exe" "$INSTDIR\${MAINBINARYNAME}.exe.old"
      Delete /REBOOTOK "$INSTDIR\${MAINBINARYNAME}.exe.old"
  _kurocat_preinstall_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Clean up any renamed-aside previous executable if unlocked now
  Delete "$INSTDIR\${MAINBINARYNAME}.exe.old"
  ; Remove legacy <=v4.2 autostart registry value if present
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "KuroCatPet"
!macroend
