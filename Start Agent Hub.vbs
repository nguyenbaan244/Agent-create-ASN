Set WshShell = CreateObject("WScript.Shell")

' Open the web browser to localhost
WshShell.Run "cmd /c start http://localhost:3000", 0, False

' Start the Node.js server in the background (0 = hidden window)
WshShell.Run "cmd /c node server.js", 0, False
