#!/bin/bash

# NetGuard Background Service Testing Script
# This script provides comprehensive testing utilities for the native Android background service

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PACKAGE_NAME="com.netguardnew"
SERVICE_NAME="com.netguardnew.backgroundservice.NetGuardBackgroundService"
LOGCAT_TAG="NetGuard"

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

check_device_connected() {
    if ! adb devices | grep -q "device$"; then
        print_error "No Android device connected or device not authorized"
        echo "Please ensure:"
        echo "1. Device is connected via USB"
        echo "2. USB Debugging is enabled"
        echo "3. Device is authorized (check device screen)"
        exit 1
    fi
    print_success "Android device connected"
}

check_app_installed() {
    if ! adb shell pm list packages | grep -q "$PACKAGE_NAME"; then
        print_error "NetGuard app is not installed on device"
        echo "Please install the app first: npx react-native run-android"
        exit 1
    fi
    print_success "NetGuard app is installed"
}

# Test functions
test_service_status() {
    print_header "Testing Service Status"

    echo "Checking if service is running..."
    SERVICE_RUNNING=$(adb shell dumpsys activity services | grep -c "$SERVICE_NAME" || true)

    if [ "$SERVICE_RUNNING" -gt 0 ]; then
        print_success "Background service is currently running"

        echo "Service details:"
        adb shell dumpsys activity services | grep -A 10 "$SERVICE_NAME" || true
    else
        print_warning "Background service is not currently running"
    fi

    echo -e "\nChecking WorkManager tasks..."
    WORK_TASKS=$(adb shell dumpsys jobscheduler | grep -c "androidx.work" || true)
    if [ "$WORK_TASKS" -gt 0 ]; then
        print_success "WorkManager tasks are scheduled ($WORK_TASKS tasks)"
    else
        print_warning "No WorkManager tasks found"
    fi
}

test_permissions() {
    print_header "Testing Permissions"

    echo "Checking app permissions..."

    PERMISSIONS=(
        "android.permission.INTERNET"
        "android.permission.ACCESS_NETWORK_STATE"
        "android.permission.FOREGROUND_SERVICE"
        "android.permission.WAKE_LOCK"
        "android.permission.RECEIVE_BOOT_COMPLETED"
    )

    for permission in "${PERMISSIONS[@]}"; do
        if adb shell dumpsys package "$PACKAGE_NAME" | grep -q "$permission.*granted=true"; then
            print_success "$permission - GRANTED"
        else
            print_warning "$permission - NOT GRANTED"
        fi
    done

    echo -e "\nChecking battery optimization status..."
    BATTERY_OPT=$(adb shell dumpsys deviceidle whitelist | grep -c "$PACKAGE_NAME" || true)
    if [ "$BATTERY_OPT" -gt 0 ]; then
        print_success "App is whitelisted from battery optimization"
    else
        print_warning "App may be subject to battery optimization"
        echo "To fix: Go to Settings > Battery > Battery Optimization > NetGuard > Don't optimize"
    fi
}

test_notifications() {
    print_header "Testing Notifications"

    echo "Checking notification channels..."
    NOTIFICATION_CHANNELS=$(adb shell dumpsys notification | grep -A 5 "$PACKAGE_NAME" || true)

    if [ -n "$NOTIFICATION_CHANNELS" ]; then
        print_success "Notification channels found"
        echo "$NOTIFICATION_CHANNELS"
    else
        print_warning "No notification channels found"
    fi

    echo -e "\nChecking active notifications..."
    ACTIVE_NOTIFICATIONS=$(adb shell dumpsys notification | grep -A 3 "NotificationRecord.*$PACKAGE_NAME" || true)

    if [ -n "$ACTIVE_NOTIFICATIONS" ]; then
        print_success "Active notifications found"
        echo "$ACTIVE_NOTIFICATIONS"
    else
        print_info "No active notifications (service may not be running)"
    fi
}

start_service_test() {
    print_header "Starting Service Test"

    print_info "Opening NetGuard app..."
    adb shell am start -n "$PACKAGE_NAME/.MainActivity"
    sleep 3

    print_info "Starting background service via app..."
    echo "Please manually start the background service in the app"
    echo "Press Enter when service is started..."
    read -r

    echo "Waiting for service to initialize..."
    sleep 5

    test_service_status
    test_notifications
}

stop_service_test() {
    print_header "Stopping Service Test"

    print_info "Stopping background service..."
    adb shell am stopservice "$SERVICE_NAME"

    sleep 3

    test_service_status
}

app_kill_test() {
    print_header "App Kill Test"

    print_info "This test will verify service survives app termination"
    echo "1. Start the service first if not running"
    echo "2. Press Enter to continue with kill test"
    read -r

    print_info "Taking baseline measurement..."
    test_service_status

    print_info "Force killing app..."
    adb shell am force-stop "$PACKAGE_NAME"

    print_info "Waiting 30 seconds..."
    for i in {30..1}; do
        echo -ne "\rWaiting $i seconds..."
        sleep 1
    done
    echo

    print_info "Checking if service survived..."
    test_service_status
}

reboot_test() {
    print_header "Reboot Test (Interactive)"

    print_warning "This test requires manual device reboot"
    echo "Steps:"
    echo "1. Ensure background service is running"
    echo "2. Note current service status"
    echo "3. Reboot your device manually"
    echo "4. Wait for full boot completion"
    echo "5. Run: $0 --test-status"
    echo "6. Verify service auto-started"

    echo -e "\nPress Enter to see current status, then reboot manually..."
    read -r

    test_service_status
}

network_test() {
    print_header "Network Connectivity Test"

    print_info "Testing network connectivity from device..."

    TEST_URLS=(
        "https://www.google.com"
        "https://httpbin.org/get"
        "https://webhook.site/unique-id"
    )

    for url in "${TEST_URLS[@]}"; do
        echo -n "Testing $url... "
        if adb shell "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 '$url'" 2>/dev/null | grep -q "200"; then
            print_success "OK"
        else
            print_error "FAILED"
        fi
    done
}

monitor_logs() {
    print_header "Live Log Monitoring"

    echo "Starting live log monitoring for NetGuard..."
    echo "Press Ctrl+C to stop"
    echo

    adb logcat | grep --line-buffered -E "($LOGCAT_TAG|NetGuardBgService|NetGuardPeriodicWorker|NetGuardBootReceiver)" | while read -r line; do
        echo -e "${GREEN}$(date '+%H:%M:%S')${NC} $line"
    done
}

performance_test() {
    print_header "Performance Test"

    print_info "Monitoring app performance metrics..."

    echo "Memory usage:"
    adb shell dumpsys meminfo "$PACKAGE_NAME" | grep -A 10 "App Summary" || true

    echo -e "\nCPU usage (sample):"
    adb shell top -n 1 | grep "$PACKAGE_NAME" || print_info "App not currently consuming significant CPU"

    echo -e "\nBattery usage:"
    adb shell dumpsys batterystats | grep -A 5 "$PACKAGE_NAME" || print_info "Battery stats not available"

    echo -e "\nNetwork usage:"
    adb shell cat /proc/net/xt_qtaguid/stats | grep $(adb shell dumpsys package "$PACKAGE_NAME" | grep userId | head -1 | cut -d'=' -f2) || print_info "Network stats not available"
}

comprehensive_test() {
    print_header "Comprehensive Test Suite"

    print_info "Running full test suite..."

    check_device_connected
    check_app_installed
    test_permissions
    test_service_status
    test_notifications
    network_test
    performance_test

    print_header "Test Results Summary"
    print_success "Comprehensive test completed"
    print_info "Check individual test results above"
}

debug_dump() {
    print_header "Debug Information Dump"

    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    DEBUG_FILE="netguard_debug_$TIMESTAMP.txt"

    print_info "Collecting debug information to $DEBUG_FILE..."

    {
        echo "NetGuard Debug Dump - $TIMESTAMP"
        echo "========================================"
        echo

        echo "Device Information:"
        adb shell getprop ro.product.model
        adb shell getprop ro.build.version.release
        adb shell getprop ro.build.version.sdk
        echo

        echo "App Information:"
        adb shell dumpsys package "$PACKAGE_NAME" | head -20
        echo

        echo "Service Status:"
        adb shell dumpsys activity services | grep -A 20 "$SERVICE_NAME" || echo "Service not running"
        echo

        echo "Notification Status:"
        adb shell dumpsys notification | grep -A 10 "$PACKAGE_NAME" || echo "No notifications"
        echo

        echo "WorkManager Status:"
        adb shell dumpsys jobscheduler | grep -A 10 "androidx.work" || echo "No WorkManager jobs"
        echo

        echo "Recent Logs (last 100 lines):"
        adb logcat -d | grep "$LOGCAT_TAG" | tail -100

    } > "$DEBUG_FILE"

    print_success "Debug information saved to $DEBUG_FILE"
    echo "You can share this file for troubleshooting"
}

setup_test_environment() {
    print_header "Setting Up Test Environment"

    print_info "Installing test URLs and callback configuration..."

    # Start the app
    adb shell am start -n "$PACKAGE_NAME/.MainActivity"
    sleep 2

    echo "Test setup completed. Please manually configure:"
    echo "1. Add test URLs (e.g., google.com, github.com)"
    echo "2. Set callback URL to webhook.site"
    echo "3. Enable background service"
    echo
    echo "Press Enter when setup is complete..."
    read -r
}

show_help() {
    echo "NetGuard Background Service Testing Script"
    echo "Usage: $0 [OPTION]"
    echo
    echo "Options:"
    echo "  --test-status         Check current service status"
    echo "  --test-permissions    Check app permissions"
    echo "  --test-notifications  Check notification system"
    echo "  --test-network        Test network connectivity"
    echo "  --test-performance    Monitor app performance"
    echo "  --start-service       Interactive service start test"
    echo "  --stop-service        Stop background service"
    echo "  --app-kill-test       Test service survival after app kill"
    echo "  --reboot-test         Interactive reboot test guide"
    echo "  --monitor-logs        Live log monitoring"
    echo "  --comprehensive       Run all tests"
    echo "  --debug-dump          Create debug information file"
    echo "  --setup-test          Setup test environment"
    echo "  --help               Show this help message"
    echo
    echo "Examples:"
    echo "  $0 --comprehensive           # Run full test suite"
    echo "  $0 --monitor-logs           # Watch live logs"
    echo "  $0 --test-status            # Quick status check"
    echo "  $0 --app-kill-test          # Test service resilience"
}

# Main execution
case "${1:-}" in
    --test-status)
        check_device_connected
        test_service_status
        ;;
    --test-permissions)
        check_device_connected
        test_permissions
        ;;
    --test-notifications)
        check_device_connected
        test_notifications
        ;;
    --test-network)
        check_device_connected
        network_test
        ;;
    --test-performance)
        check_device_connected
        performance_test
        ;;
    --start-service)
        check_device_connected
        check_app_installed
        start_service_test
        ;;
    --stop-service)
        check_device_connected
        stop_service_test
        ;;
    --app-kill-test)
        check_device_connected
        app_kill_test
        ;;
    --reboot-test)
        reboot_test
        ;;
    --monitor-logs)
        check_device_connected
        monitor_logs
        ;;
    --comprehensive)
        comprehensive_test
        ;;
    --debug-dump)
        check_device_connected
        debug_dump
        ;;
    --setup-test)
        check_device_connected
        check_app_installed
        setup_test_environment
        ;;
    --help)
        show_help
        ;;
    "")
        echo "NetGuard Background Service Tester"
        echo "Run with --help for options"
        echo
        show_help
        ;;
    *)
        print_error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac
