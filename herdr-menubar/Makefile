# Builds a minimal arm64 .app bundle. No Xcode project, no dependencies.
APP     := HerdrMenuBar
BUNDLE  := build/$(APP).app
TARGET  := arm64-apple-macos13.0

.PHONY: all run install clean

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

clean:
	rm -rf build
