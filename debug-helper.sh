#!/bin/bash

# NetGuard Pro Debug Helper Script
# Helps fix connection issues and debug problems

echo "======================================"
echo "🔧 NetGuard Pro Debug Helper"
echo "======================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "ℹ️  $1"
}

# Check if running in NetGuardNew directory
if [ ! -f "package.json" ]; then
    print_error "Please run this script from the NetGuardNew directory"
    exit 1
fi

# Main menu
show_menu() {
    echo ""
    echo "Select an option:"
    echo "1) 🔄 Fix Connection Issues (Recommended)"
    echo "2) 🧹 Clear All Caches"
    echo "3) 🔍 Check Network & Debugger Status"
    echo "4) 📱 Android: Fix Debugger Connection"
    echo "5) 🍎 iOS: Fix Debugger Connection"
    echo "6) 🚀 Start Without Debugger"
    echo "7) 📊 View Live Logs"
    echo "8) 🔧 Fix Callback Issues"
    echo "9) 🔨 Full Reset & Rebuild"
    echo "0) Exit"
    echo ""
    read -p "Enter choice [0-9]: " choice
}

# Fix connection issues
fix_connection_issues() {
    print_info "Fixing connection issues..."

    # Kill existing processes
    print_info "Stopping existing processes..."
    pkill -f "react-native.*metro"
    pkill -f "react-native.*start"
    pkill -f "node.*metro"
    adb reverse --remove-all 2>/dev/null

    # Clear React Native cache
    print_info "Clearing React Native cache..."
    npx react-native start --reset-cache &
    METRO_PID=$!
    sleep 5
    kill $METRO_PID 2>/dev/null

    # Reset ADB for Android
    if command -v adb &> /dev/null; then
        print_info "Resetting ADB..."
        adb kill-server
        adb start-server
        adb reverse tcp:8081 tcp:8081
        adb reverse tcp:8097 tcp:8097
        print_success "ADB reset complete"
    fi

    print_success "Connection issues fixed!"
}

# Clear all caches
clear_all_caches() {
    print_info "Clearing all caches..."

    # NPM cache
    print_info "Clearing NPM cache..."
    npm cache clean --force

    # Metro cache
    print_info "Clearing Metro cache..."
    rm -rf $TMPDIR/metro-*
    rm -rf $TMPDIR/haste-*
    rm -rf $TMPDIR/react-*

    # Watchman cache
    if command -v watchman &> /dev/null; then
        print_info "Clearing Watchman cache..."
        watchman watch-del-all
    fi

    # Android caches
    if [ -d "android" ]; then
        print_info "Clearing Android caches..."
        cd android
        ./gradlew clean
        cd ..
        rm -rf android/app/build
        rm -rf android/build
    fi

    # iOS caches
    if [ -d "ios" ]; then
        print_info "Clearing iOS caches..."
        rm -rf ios/build
        rm -rf ~/Library/Developer/Xcode/DerivedData
    fi

    # Node modules
    print_warning "Removing node_modules..."
    rm -rf node_modules

    print_info "Reinstalling dependencies..."
    npm install

    if [ -d "ios" ]; then
        cd ios
        pod install
        cd ..
    fi

    print_success "All caches cleared!"
}

# Check network and debugger status
check_status() {
    print_info "Checking system status..."
    echo ""

    # Check Metro bundler
    echo "Metro Bundler:"
    if pgrep -f "metro" > /dev/null; then
        print_success "Metro is running"
        ps aux | grep metro | grep -v grep | head -1
    else
        print_warning "Metro is not running"
    fi
    echo ""

    # Check port 8081
    echo "Port 8081 (Metro):"
    if lsof -i :8081 > /dev/null 2>&1; then
        print_success "Port 8081 is in use"
        lsof -i :8081 | head -2
    else
        print_warning "Port 8081 is free"
    fi
    echo ""

    # Check ADB devices
    if command -v adb &> /dev/null; then
        echo "Android Devices:"
        adb devices
        echo ""

        echo "ADB Reverse Ports:"
        adb reverse --list
    fi
    echo ""

    # Check network interfaces
    echo "Network Interfaces:"
    if command -v ifconfig &> /dev/null; then
        ifconfig | grep "inet " | grep -v "127.0.0.1"
    elif command -v ip &> /dev/null; then
        ip addr show | grep "inet " | grep -v "127.0.0.1"
    fi
}

# Fix Android debugger
fix_android_debugger() {
    print_info "Fixing Android debugger connection..."

    # Kill existing connections
    adb shell am force-stop com.netguardnew

    # Clear app data (optional - will reset app settings)
    read -p "Clear app data? This will reset all settings (y/N): " clear_data
    if [[ $clear_data =~ ^[Yy]$ ]]; then
        adb shell pm clear com.netguardnew
    fi

    # Reset network settings
    adb reverse --remove-all
    adb reverse tcp:8081 tcp:8081
    adb reverse tcp:8097 tcp:8097

    # Enable debugging
    adb shell settings put global development_settings_enabled 1
    adb shell settings put global adb_enabled 1

    print_success "Android debugger fixed!"
    print_info "Now run: npx react-native run-android"
}

# Fix iOS debugger
fix_ios_debugger() {
    print_info "Fixing iOS debugger connection..."

    # Kill simulator
    killall "Simulator" 2>/dev/null

    # Clear derived data
    rm -rf ~/Library/Developer/Xcode/DerivedData

    # Reset simulator
    xcrun simctl shutdown all
    xcrun simctl erase all

    print_success "iOS debugger fixed!"
    print_info "Now run: npx react-native run-ios"
}

# Start without debugger
start_without_debugger() {
    print_info "Starting app without debugger..."

    # Start Metro without debugger
    print_info "Starting Metro bundler..."
    npx react-native start --no-interactive &

    sleep 3

    # Prompt for platform
    read -p "Select platform (a)ndroid / (i)OS: " platform

    if [[ $platform =~ ^[Aa]$ ]]; then
        print_info "Building Android release..."
        cd android
        ./gradlew assembleRelease
        adb install -r app/build/outputs/apk/release/app-release.apk
        adb shell am start -n com.netguardnew/.MainActivity
        cd ..
        print_success "Android app started without debugger"
    elif [[ $platform =~ ^[Ii]$ ]]; then
        print_info "Building iOS release..."
        npx react-native run-ios --configuration Release
        print_success "iOS app started without debugger"
    fi
}

# View live logs
view_logs() {
    print_info "Starting log viewer..."

    read -p "Select platform (a)ndroid / (i)OS / (m)etro: " platform

    if [[ $platform =~ ^[Aa]$ ]]; then
        print_info "Showing Android logs (Ctrl+C to stop)..."
        adb logcat | grep -E "(ReactNative|ReactNativeJS|netguard|NetGuard|CALLBACK|URL|CHECK)"
    elif [[ $platform =~ ^[Ii]$ ]]; then
        print_info "Showing iOS logs (Ctrl+C to stop)..."
        npx react-native log-ios
    elif [[ $platform =~ ^[Mm]$ ]]; then
        print_info "Starting Metro with logging..."
        npx react-native start --verbose
    fi
}

# Fix callback issues
fix_callback_issues() {
    print_info "Fixing callback issues..."

    # Check network connectivity
    print_info "Testing network connectivity..."
    if ping -c 1 google.com &> /dev/null; then
        print_success "Internet connection is working"
    else
        print_error "No internet connection!"
        return
    fi

    # Test callback URL if provided
    read -p "Enter your callback URL (or press Enter to skip): " callback_url
    if [ ! -z "$callback_url" ]; then
        print_info "Testing callback URL..."
        response=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
            -H "Content-Type: application/json" \
            -d '{"test": true}' \
            --max-time 10 \
            "$callback_url")

        if [ "$response" -ge 200 ] && [ "$response" -lt 300 ]; then
            print_success "Callback URL is reachable (Status: $response)"
        elif [ "$response" -eq 000 ]; then
            print_error "Callback URL is not reachable (Timeout)"
        else
            print_warning "Callback URL returned status: $response"
        fi
    fi

    # Fix timeout settings
    print_info "Applying timeout fixes..."

    # Create .env file with extended timeouts
    cat > .env << EOF
# Network timeouts (milliseconds)
REQUEST_TIMEOUT=30000
CALLBACK_TIMEOUT=15000
DEBUG_MODE=true
EOF

    print_success "Timeout settings updated"

    # Restart Metro with new settings
    print_info "Restarting Metro bundler..."
    pkill -f "metro"
    npx react-native start --reset-cache &

    print_success "Callback issues fixed!"
    print_info "Make sure to rebuild the app"
}

# Full reset and rebuild
full_reset() {
    print_warning "This will completely reset and rebuild the project!"
    read -p "Are you sure? (y/N): " confirm

    if [[ ! $confirm =~ ^[Yy]$ ]]; then
        print_info "Cancelled"
        return
    fi

    print_info "Starting full reset..."

    # Stop everything
    fix_connection_issues

    # Clear everything
    clear_all_caches

    # Rebuild Android
    if [ -d "android" ]; then
        print_info "Rebuilding Android..."
        npx react-native run-android
    fi

    print_success "Full reset complete!"
}

# Main loop
while true; do
    show_menu
    case $choice in
        1) fix_connection_issues ;;
        2) clear_all_caches ;;
        3) check_status ;;
        4) fix_android_debugger ;;
        5) fix_ios_debugger ;;
        6) start_without_debugger ;;
        7) view_logs ;;
        8) fix_callback_issues ;;
        9) full_reset ;;
        0)
            print_info "Exiting..."
            exit 0
            ;;
        *)
            print_error "Invalid option"
            ;;
    esac

    echo ""
    read -p "Press Enter to continue..."
done
