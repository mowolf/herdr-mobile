# Builds a minimal arm64 .app bundle. No Xcode project, no dependencies.
APP     := HerdrMenuBar
BUNDLE  := build/$(APP).app
TARGET  := arm64-apple-macos13.0

.PHONY: all run install login unlogin clean

all: $(BUNDLE)

$(BUNDLE): main.m Info.plist
	@mkdir -p $(BUNDLE)/Contents/MacOS
	clang -O2 -fobjc-arc -target $(TARGET) -framework AppKit \
	    -o $(BUNDLE)/Contents/MacOS/$(APP) main.m
	@cp Info.plist $(BUNDLE)/Contents/Info.plist
	@echo "built $(BUNDLE)"

run: $(BUNDLE)
	open $(BUNDLE)

# Copy to /Applications so it can be added to Login Items.
install: $(BUNDLE)
	rm -rf /Applications/$(APP).app
	cp -R $(BUNDLE) /Applications/
	@echo "installed to /Applications/$(APP).app"

# Start at login. A LaunchAgent rather than a Login Item because scripting
# System Events needs Automation permission that cannot be prompted for here.
login: install
	cp com.herdr.menubar.plist ~/Library/LaunchAgents/
	-launchctl bootout gui/$$(id -u)/com.herdr.menubar 2>/dev/null
	launchctl bootstrap gui/$$(id -u) ~/Library/LaunchAgents/com.herdr.menubar.plist
	@echo "will start at login"

unlogin:
	-launchctl bootout gui/$$(id -u)/com.herdr.menubar
	rm -f ~/Library/LaunchAgents/com.herdr.menubar.plist
	@echo "removed from login"

clean:
	rm -rf build
