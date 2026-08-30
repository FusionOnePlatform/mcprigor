# VHS tape for the README demo GIF — https://github.com/charmbracelet/vhs
# The CLI segment of the enterprise showcase. Records against a real MCP server.
Output demo.gif

Set FontSize 19
Set FontFamily "Menlo"
Set Width 1080
Set Height 650
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 24ms

Hide
Type "cd /tmp/mcprigor-demo && clear"
Enter
Show

Type "# MCP release governance — deterministic, no AI at runtime"
Sleep 1s
Enter
Type "cat order.mcpr"
Enter
Sleep 2.8s

Type "npx mcprigor check order.mcpr"
Enter
Sleep 1.8s

Type "npx mcprigor convert order.mcpr --out order.yaml"
Enter
Sleep 1.6s

Type "npx mcprigor test order.yaml --html report.html"
Enter
Sleep 3.4s

Type "npx mcprigor publish order.mcpr --out shareable-report"
Enter
Sleep 3.2s

Type "# One suite. English or YAML. Local, CI, monitoring, evidence."
Sleep 2.4s
