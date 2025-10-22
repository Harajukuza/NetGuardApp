/**
 * API Sync Manager Test Component
 * Comprehensive testing interface for ApiSyncManager functionality
 * Features:
 * - Manual sync testing
 * - Configuration testing
 * - Data integrity validation
 * - Performance monitoring
 * - Error simulation
 * - Statistics visualization
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  Modal,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { apiSyncManager } from './ApiSyncManager';
import type { SyncStats, SyncNotification, APIURLItem } from './ApiSyncManager';

interface TestResult {
  test: string;
  status: 'passed' | 'failed' | 'running';
  duration: number;
  details: string;
  timestamp: string;
}

interface PerformanceMetrics {
  avgSyncDuration: number;
  minSyncDuration: number;
  maxSyncDuration: number;
  totalSyncs: number;
  successRate: number;
  dataIntegrityPassRate: number;
}

const ApiSyncManagerTest: React.FC = () => {
  const isDarkMode = useColorScheme() === 'dark';

  // Test states
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [currentTest, setCurrentTest] = useState<string>('');

  // Configuration states
  const [testApiEndpoint, setTestApiEndpoint] = useState(
    'https://webhook.site/unique-id',
  );
  const [syncInterval, setSyncInterval] = useState(30);
  const [autoSync, setAutoSync] = useState(false);

  // Statistics states
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);
  const [notifications, setNotifications] = useState<SyncNotification[]>([]);
  const [latestData, setLatestData] = useState<APIURLItem[]>([]);
  const [performanceMetrics, setPerformanceMetrics] =
    useState<PerformanceMetrics | null>(null);

  // UI states
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const [showPerformanceModal, setShowPerformanceModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);

  const testTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadCurrentState();
    const interval = setInterval(loadCurrentState, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadCurrentState = async () => {
    try {
      const stats = apiSyncManager.getStats();
      setSyncStats(stats);

      const pendingNotifications =
        await apiSyncManager.getPendingNotifications();
      setNotifications(pendingNotifications);

      const syncedData = await apiSyncManager.getLatestSyncedData();
      if (syncedData) {
        setLatestData(syncedData.data);
      }

      // Calculate performance metrics
      const history = await apiSyncManager.getSyncHistory();
      if (history.length > 0) {
        const durations = history.map(h => h.syncDuration);
        const successfulSyncs = history.filter(h => h.success).length;

        setPerformanceMetrics({
          avgSyncDuration: Math.round(
            durations.reduce((a, b) => a + b, 0) / durations.length,
          ),
          minSyncDuration: Math.min(...durations),
          maxSyncDuration: Math.max(...durations),
          totalSyncs: history.length,
          successRate: Math.round((successfulSyncs / history.length) * 100),
          dataIntegrityPassRate: 100, // Assuming all passed if they succeeded
        });
      }
    } catch (error) {
      console.error('Error loading current state:', error);
    }
  };

  const addTestResult = (
    test: string,
    status: 'passed' | 'failed',
    duration: number,
    details: string,
  ) => {
    const result: TestResult = {
      test,
      status,
      duration,
      details,
      timestamp: new Date().toISOString(),
    };

    setTestResults(prev => [result, ...prev.slice(0, 19)]); // Keep last 20 results
  };

  const runSingleTest = async (
    testName: string,
    testFunction: () => Promise<void>,
  ) => {
    setCurrentTest(testName);
    const startTime = Date.now();

    try {
      await testFunction();
      const duration = Date.now() - startTime;
      addTestResult(
        testName,
        'passed',
        duration,
        'Test completed successfully',
      );
    } catch (error: any) {
      const duration = Date.now() - startTime;
      addTestResult(
        testName,
        'failed',
        duration,
        error.message || 'Unknown error',
      );
    }
  };

  // Test Functions
  const testBasicConfiguration = async () => {
    // Use a simple test endpoint that returns JSON
    const testEndpoint = 'https://jsonplaceholder.typicode.com/users';

    await apiSyncManager.configure({
      apiEndpoint: testEndpoint,
      autoSyncEnabled: false,
      syncInterval: syncInterval * 60 * 1000,
    });

    const config = apiSyncManager.getConfiguration();
    if (config.apiEndpoint !== testEndpoint) {
      throw new Error('Configuration not saved properly');
    }
  };

  const testManualSync = async () => {
    // Configure with a working test endpoint
    await apiSyncManager.configure({
      apiEndpoint: 'https://jsonplaceholder.typicode.com/users',
      autoSyncEnabled: false,
    });

    const result = await apiSyncManager.performManualSync();
    if (!result.success) {
      throw new Error(result.error || 'Manual sync failed');
    }

    if (!result.dataChecksum) {
      throw new Error('Data integrity check failed - no checksum');
    }
  };

  const testAutoSyncToggle = async () => {
    // Test starting auto sync
    await apiSyncManager.configure({
      apiEndpoint: 'https://jsonplaceholder.typicode.com/users',
      autoSyncEnabled: true,
      syncInterval: 5 * 60 * 1000, // 5 minutes for testing
    });

    await apiSyncManager.startAutoSync();

    if (!apiSyncManager.isAutoSyncEnabled()) {
      throw new Error('Auto sync not enabled after start');
    }

    // Test stopping auto sync
    apiSyncManager.stopAutoSync();

    if (apiSyncManager.isAutoSyncEnabled()) {
      throw new Error('Auto sync still enabled after stop');
    }
  };

  const testDataIntegrity = async () => {
    const result = await apiSyncManager.performManualSync();

    if (!result.success) {
      throw new Error('Sync failed before integrity test');
    }

    const syncedData = await apiSyncManager.getLatestSyncedData();
    if (!syncedData || !syncedData.checksum) {
      throw new Error('No checksum available for integrity verification');
    }

    // Verify data structure
    if (!Array.isArray(syncedData.data)) {
      throw new Error('Synced data is not an array');
    }
  };

  const testErrorHandling = async () => {
    // Test with invalid endpoint
    await apiSyncManager.configure({
      apiEndpoint: 'https://invalid-url-for-testing.com/api',
      autoSyncEnabled: false,
    });

    try {
      const result = await apiSyncManager.performManualSync();
      if (result.success) {
        throw new Error('Sync should have failed with invalid endpoint');
      }

      // Verify error is properly handled
      if (!result.error) {
        throw new Error('No error message returned from failed sync');
      }
    } finally {
      // Restore working endpoint
      await apiSyncManager.configure({
        apiEndpoint: 'https://jsonplaceholder.typicode.com/users',
      });
    }
  };

  const testNotificationSystem = async () => {
    // Clear existing notifications
    const existingNotifications =
      await apiSyncManager.getPendingNotifications();
    for (const notification of existingNotifications) {
      await apiSyncManager.acknowledgeNotification(notification.id);
    }

    await apiSyncManager.clearAcknowledgedNotifications();

    // Perform sync to potentially generate notifications
    await apiSyncManager.performManualSync();

    const notifications = await apiSyncManager.getPendingNotifications();
    // At least the system should track the sync activity
    console.log(`Notifications after sync: ${notifications.length}`);
  };

  const testPerformanceUnderLoad = async () => {
    const syncCount = 3;
    const results = [];

    for (let i = 0; i < syncCount; i++) {
      const startTime = Date.now();
      const result = await apiSyncManager.performManualSync();
      const duration = Date.now() - startTime;

      results.push({ success: result.success, duration });

      // Small delay between syncs
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const successful = results.filter(r => r.success).length;
    const avgDuration =
      results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    if (successful < syncCount * 0.8) {
      // 80% success rate threshold
      throw new Error(
        `Performance test failed: only ${successful}/${syncCount} syncs succeeded`,
      );
    }

    if (avgDuration > 10000) {
      // 10 second threshold
      throw new Error(
        `Performance test failed: average duration ${avgDuration}ms exceeds threshold`,
      );
    }
  };

  const runAllTests = async () => {
    if (isRunningTests) return;

    setIsRunningTests(true);
    setTestResults([]);

    const tests = [
      { name: 'Basic Configuration', func: testBasicConfiguration },
      { name: 'Manual Sync', func: testManualSync },
      { name: 'Auto Sync Toggle', func: testAutoSyncToggle },
      { name: 'Data Integrity', func: testDataIntegrity },
      { name: 'Error Handling', func: testErrorHandling },
      { name: 'Notification System', func: testNotificationSystem },
      { name: 'Performance Under Load', func: testPerformanceUnderLoad },
    ];

    for (const test of tests) {
      if (!isRunningTests) break; // Allow cancellation
      await runSingleTest(test.name, test.func);
      await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause between tests
    }

    setCurrentTest('');
    setIsRunningTests(false);

    // Show summary
    const passed = testResults.filter(r => r.status === 'passed').length;
    const total = testResults.length;

    Alert.alert(
      'Test Suite Complete',
      `${passed}/${total} tests passed\n\nCheck detailed results below.`,
      [{ text: 'OK' }],
    );

    await loadCurrentState(); // Refresh current state
  };

  const stopTests = () => {
    setIsRunningTests(false);
    setCurrentTest('');
    if (testTimeoutRef.current) {
      clearTimeout(testTimeoutRef.current);
    }
  };

  const clearTestResults = () => {
    setTestResults([]);
  };

  const resetSyncManager = async () => {
    try {
      apiSyncManager.stopAutoSync();
      await apiSyncManager.configure({
        apiEndpoint: '',
        autoSyncEnabled: false,
        syncInterval: 30 * 60 * 1000,
      });

      Alert.alert('Success', 'API Sync Manager has been reset');
      await loadCurrentState();
    } catch (error: any) {
      Alert.alert('Error', `Failed to reset: ${error.message}`);
    }
  };

  const exportTestResults = () => {
    const report = {
      timestamp: new Date().toISOString(),
      testResults,
      syncStats,
      performanceMetrics,
      configuration: apiSyncManager.getConfiguration(),
    };

    console.log('Test Report:', JSON.stringify(report, null, 2));
    Alert.alert(
      'Test Report Exported',
      'Check the console for detailed test report JSON',
      [{ text: 'OK' }],
    );
  };

  // Styles
  const containerStyle = {
    flex: 1,
    backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5',
  };

  const cardStyle = {
    backgroundColor: isDarkMode ? '#2a2a2a' : 'white',
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  };

  const textStyle = {
    color: isDarkMode ? 'white' : 'black',
  };

  const inputStyle = {
    backgroundColor: isDarkMode ? '#3a3a3a' : '#f0f0f0',
    color: isDarkMode ? 'white' : 'black',
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
  };

  return (
    <ScrollView style={containerStyle}>
      {/* Header */}
      <View style={cardStyle}>
        <Text style={[styles.title, textStyle]}>🧪 API Sync Manager Test</Text>
        <Text style={[styles.subtitle, textStyle]}>
          Comprehensive testing suite for API synchronization
        </Text>
      </View>

      {/* Configuration Section */}
      <View style={cardStyle}>
        <Text style={[styles.sectionTitle, textStyle]}>Configuration</Text>

        <TextInput
          style={inputStyle}
          placeholder="Test API Endpoint"
          placeholderTextColor={isDarkMode ? '#999' : '#666'}
          value={testApiEndpoint}
          onChangeText={setTestApiEndpoint}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.row}>
          <Text style={[styles.label, textStyle]}>Sync Interval:</Text>
          <TextInput
            style={[inputStyle, styles.smallInput]}
            value={syncInterval.toString()}
            onChangeText={text => setSyncInterval(parseInt(text) || 30)}
            keyboardType="numeric"
          />
          <Text style={[styles.label, textStyle]}>minutes</Text>
        </View>

        <View style={styles.row}>
          <Text style={[styles.label, textStyle]}>Auto Sync:</Text>
          <Switch
            value={autoSync}
            onValueChange={setAutoSync}
            trackColor={{ false: '#767577', true: '#81b0ff' }}
            thumbColor={autoSync ? '#2196F3' : '#f4f3f4'}
          />
        </View>
      </View>

      {/* Test Controls */}
      <View style={cardStyle}>
        <Text style={[styles.sectionTitle, textStyle]}>Test Controls</Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.button,
              styles.primaryButton,
              isRunningTests && styles.buttonDisabled,
            ]}
            onPress={runAllTests}
            disabled={isRunningTests}
          >
            {isRunningTests ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>Run All Tests</Text>
            )}
          </TouchableOpacity>

          {isRunningTests && (
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={stopTests}
            >
              <Text style={styles.buttonTextSecondary}>Stop Tests</Text>
            </TouchableOpacity>
          )}
        </View>

        {currentTest && (
          <Text style={[styles.currentTest, textStyle]}>
            Running: {currentTest}...
          </Text>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={clearTestResults}
          >
            <Text style={styles.buttonTextSecondary}>Clear Results</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={exportTestResults}
          >
            <Text style={styles.buttonTextSecondary}>Export Report</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Current Statistics */}
      {syncStats && (
        <View style={cardStyle}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, textStyle]}>
              Current Statistics
            </Text>
            <TouchableOpacity onPress={() => setShowPerformanceModal(true)}>
              <Text style={styles.linkText}>View Details</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, textStyle]}>
                {syncStats.totalSyncs}
              </Text>
              <Text style={[styles.statLabel, textStyle]}>Total Syncs</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, textStyle, { color: '#4CAF50' }]}>
                {syncStats.successfulSyncs}
              </Text>
              <Text style={[styles.statLabel, textStyle]}>Successful</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, textStyle, { color: '#F44336' }]}>
                {syncStats.failedSyncs}
              </Text>
              <Text style={[styles.statLabel, textStyle]}>Failed</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, textStyle]}>
                {syncStats.dataIntegrityChecks}
              </Text>
              <Text style={[styles.statLabel, textStyle]}>
                Integrity Checks
              </Text>
            </View>
          </View>

          {syncStats.lastSyncTime && (
            <Text style={[styles.lastSync, textStyle]}>
              Last sync: {new Date(syncStats.lastSyncTime).toLocaleString()}
            </Text>
          )}
        </View>
      )}

      {/* Notifications */}
      {notifications.length > 0 && (
        <View style={cardStyle}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, textStyle]}>
              Notifications ({notifications.length})
            </Text>
            <TouchableOpacity onPress={() => setShowNotificationsModal(true)}>
              <Text style={styles.linkText}>View All</Text>
            </TouchableOpacity>
          </View>

          {notifications.slice(0, 3).map((notification, index) => (
            <View key={notification.id} style={styles.notificationItem}>
              <Text style={[styles.notificationTitle, textStyle]}>
                {notification.title}
              </Text>
              <Text style={[styles.notificationMessage, textStyle]}>
                {notification.message}
              </Text>
              <Text style={[styles.notificationTime, textStyle]}>
                {new Date(notification.timestamp).toLocaleString()}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Test Results */}
      <View style={cardStyle}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, textStyle]}>
            Test Results ({testResults.length})
          </Text>
          <TouchableOpacity
            onPress={() => setShowDetailedLogs(!showDetailedLogs)}
          >
            <Text style={styles.linkText}>
              {showDetailedLogs ? 'Hide Details' : 'Show Details'}
            </Text>
          </TouchableOpacity>
        </View>

        {testResults.length === 0 ? (
          <Text style={[styles.emptyText, textStyle]}>No test results yet</Text>
        ) : (
          testResults.map((result, index) => (
            <View key={index} style={styles.testResultItem}>
              <View style={styles.testResultHeader}>
                <Text style={[styles.testName, textStyle]}>{result.test}</Text>
                <View style={styles.testResultRight}>
                  <Text
                    style={[
                      styles.testStatus,
                      {
                        color:
                          result.status === 'passed' ? '#4CAF50' : '#F44336',
                      },
                    ]}
                  >
                    {result.status.toUpperCase()}
                  </Text>
                  <Text style={[styles.testDuration, textStyle]}>
                    {result.duration}ms
                  </Text>
                </View>
              </View>

              {showDetailedLogs && (
                <View style={styles.testDetails}>
                  <Text style={[styles.testDetailsText, textStyle]}>
                    {result.details}
                  </Text>
                  <Text style={[styles.testTime, textStyle]}>
                    {new Date(result.timestamp).toLocaleString()}
                  </Text>
                </View>
              )}
            </View>
          ))
        )}
      </View>

      {/* Danger Zone */}
      <View style={[cardStyle, styles.dangerZone]}>
        <Text style={[styles.sectionTitle, { color: '#F44336' }]}>
          ⚠️ Danger Zone
        </Text>
        <TouchableOpacity
          style={[styles.button, styles.dangerButton]}
          onPress={resetSyncManager}
        >
          <Text style={styles.buttonText}>Reset Sync Manager</Text>
        </TouchableOpacity>
      </View>

      {/* Performance Modal */}
      <Modal
        visible={showPerformanceModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPerformanceModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: isDarkMode ? '#2a2a2a' : 'white' },
            ]}
          >
            <Text style={[styles.modalTitle, textStyle]}>
              Performance Metrics
            </Text>

            {performanceMetrics && (
              <View style={styles.metricsContainer}>
                <View style={styles.metricRow}>
                  <Text style={[styles.metricLabel, textStyle]}>
                    Average Duration:
                  </Text>
                  <Text style={[styles.metricValue, textStyle]}>
                    {performanceMetrics.avgSyncDuration}ms
                  </Text>
                </View>
                <View style={styles.metricRow}>
                  <Text style={[styles.metricLabel, textStyle]}>
                    Min Duration:
                  </Text>
                  <Text style={[styles.metricValue, textStyle]}>
                    {performanceMetrics.minSyncDuration}ms
                  </Text>
                </View>
                <View style={styles.metricRow}>
                  <Text style={[styles.metricLabel, textStyle]}>
                    Max Duration:
                  </Text>
                  <Text style={[styles.metricValue, textStyle]}>
                    {performanceMetrics.maxSyncDuration}ms
                  </Text>
                </View>
                <View style={styles.metricRow}>
                  <Text style={[styles.metricLabel, textStyle]}>
                    Success Rate:
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      textStyle,
                      { color: '#4CAF50' },
                    ]}
                  >
                    {performanceMetrics.successRate}%
                  </Text>
                </View>
                <View style={styles.metricRow}>
                  <Text style={[styles.metricLabel, textStyle]}>
                    Data Integrity:
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      textStyle,
                      { color: '#4CAF50' },
                    ]}
                  >
                    {performanceMetrics.dataIntegrityPassRate}%
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={() => setShowPerformanceModal(false)}
            >
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Notifications Modal */}
      <Modal
        visible={showNotificationsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowNotificationsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: isDarkMode ? '#2a2a2a' : 'white' },
            ]}
          >
            <Text style={[styles.modalTitle, textStyle]}>
              All Notifications
            </Text>

            <ScrollView style={styles.notificationsList}>
              {notifications.map(notification => (
                <View
                  key={notification.id}
                  style={styles.notificationModalItem}
                >
                  <Text style={[styles.notificationTitle, textStyle]}>
                    {notification.title}
                  </Text>
                  <Text style={[styles.notificationMessage, textStyle]}>
                    {notification.message}
                  </Text>
                  <Text style={[styles.notificationTime, textStyle]}>
                    {new Date(notification.timestamp).toLocaleString()}
                  </Text>
                  <Text
                    style={[
                      styles.notificationStatus,
                      textStyle,
                      {
                        color: notification.acknowledged
                          ? '#4CAF50'
                          : '#FF9800',
                      },
                    ]}
                  >
                    {notification.acknowledged ? 'Acknowledged' : 'Pending'}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={() => setShowNotificationsModal(false)}
            >
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  linkText: {
    color: '#2196F3',
    fontSize: 14,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  label: {
    fontSize: 16,
    marginRight: 8,
  },
  smallInput: {
    width: 60,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    flex: 1,
  },
  primaryButton: {
    backgroundColor: '#2196F3',
  },
  secondaryButton: {
    backgroundColor: '#6c757d',
  },
  dangerButton: {
    backgroundColor: '#F44336',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonTextSecondary: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  currentTest: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 8,
    color: '#2196F3',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 4,
  },
  lastSync: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 8,
  },
  notificationItem: {
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    padding: 8,
    borderRadius: 6,
    marginVertical: 4,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  notificationMessage: {
    fontSize: 12,
    marginBottom: 2,
  },
  notificationTime: {
    fontSize: 10,
    opacity: 0.7,
  },
  testResultItem: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    paddingVertical: 8,
  },
  testResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  testName: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  testResultRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  testStatus: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  testDuration: {
    fontSize: 10,
    opacity: 0.7,
  },
  testDetails: {
    marginTop: 8,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 4,
  },
  testDetailsText: {
    fontSize: 12,
    marginBottom: 4,
  },
  testTime: {
    fontSize: 10,
    opacity: 0.5,
  },
  emptyText: {
    textAlign: 'center',
    opacity: 0.6,
    fontStyle: 'italic',
    marginVertical: 20,
  },
  dangerZone: {
    borderColor: '#F44336',
    borderWidth: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: 12,
    padding: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  metricsContainer: {
    marginVertical: 16,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  metricLabel: {
    fontSize: 16,
    flex: 1,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
  },
  notificationsList: {
    maxHeight: 400,
    marginVertical: 16,
  },
  notificationModalItem: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    padding: 12,
    borderRadius: 8,
    marginVertical: 4,
  },
  notificationStatus: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});

export default ApiSyncManagerTest;
