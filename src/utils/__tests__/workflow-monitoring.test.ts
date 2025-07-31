/**
 * Workflow Monitoring Tests
 * 
 * Tests for batch workflow and episode continuation monitoring functionality
 * including CloudWatch metrics, X-Ray tracing, and performance tracking.
 * 
 * Requirements: 6A.5, 6B.6
 */

import { BusinessMetrics, CloudWatchMetrics, PerformanceTimer } from '../cloudwatch-metrics';
import { jest } from '@jest/globals';

// Mock AWS SDK
jest.mock('@aws-sdk/client-cloudwatch');

describe('Workflow Monitoring', () => {
  let mockCloudWatchClient: any;
  let mockSend: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock CloudWatch client
    mockSend = jest.fn().mockResolvedValue({});
    mockCloudWatchClient = {
      send: mockSend,
    };
    
    // Mock the CloudWatch client constructor
    const { CloudWatchClient } = require('@aws-sdk/client-cloudwatch');
    CloudWatchClient.mockImplementation(() => mockCloudWatchClient);
  });

  describe('Batch Workflow Metrics', () => {
    it('should record batch workflow progress correctly', async () => {
      const userId = 'test-user-123';
      const workflowId = 'workflow-456';
      const currentBatch = 2;
      const totalBatches = 5;

      await BusinessMetrics.recordBatchWorkflowProgress(
        userId,
        workflowId,
        currentBatch,
        totalBatches
      );

      expect(mockSend).toHaveBeenCalledTimes(2);
      
      // Check progress percentage metric
      const progressCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'BatchWorkflowProgress'
      );
      expect(progressCall).toBeDefined();
      expect(progressCall[0].input.MetricData[0].Value).toBe(40); // 2/5 * 100
      expect(progressCall[0].input.MetricData[0].Unit).toBe('Percent');
      
      // Check batch progress metric
      const batchCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'BatchProgress'
      );
      expect(batchCall).toBeDefined();
      expect(batchCall[0].input.MetricData[0].Value).toBe(2);
      expect(batchCall[0].input.MetricData[0].Unit).toBe('Count');
    });

    it('should record batch workflow success with duration', async () => {
      const userId = 'test-user-123';
      const workflowId = 'workflow-456';
      const duration = 120000; // 2 minutes
      const totalStories = 3;

      await BusinessMetrics.recordBatchWorkflowSuccess(
        userId,
        workflowId,
        duration,
        totalStories
      );

      expect(mockSend).toHaveBeenCalledTimes(2);
      
      // Check success rate metric
      const successRateCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'BatchWorkflowSuccessRate'
      );
      expect(successRateCall).toBeDefined();
      expect(successRateCall[0].input.MetricData[0].Value).toBe(100);
      expect(successRateCall[0].input.MetricData[0].Unit).toBe('Percent');
      
      // Check duration metric
      const durationCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'BatchWorkflowDuration'
      );
      expect(durationCall).toBeDefined();
      expect(durationCall[0].input.MetricData[0].Value).toBe(120000);
      expect(durationCall[0].input.MetricData[0].Unit).toBe('Milliseconds');
    });

    it('should record batch workflow failure with error context', async () => {
      const userId = 'test-user-123';
      const workflowId = 'workflow-456';
      const errorType = 'BEDROCK_API_ERROR';
      const failedAtBatch = 3;

      await BusinessMetrics.recordBatchWorkflowFailure(
        userId,
        workflowId,
        errorType,
        failedAtBatch
      );

      expect(mockSend).toHaveBeenCalledTimes(2);
      
      // Check failure rate metric
      const failureRateCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'BatchWorkflowSuccessRate'
      );
      expect(failureRateCall).toBeDefined();
      expect(failureRateCall[0].input.MetricData[0].Value).toBe(0);
      
      // Check error metric
      const errorCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'BatchWorkflowErrors'
      );
      expect(errorCall).toBeDefined();
      expect(errorCall[0].input.MetricData[0].Value).toBe(1);
      
      // Verify dimensions include error context
      const dimensions = errorCall[0].input.MetricData[0].Dimensions;
      expect(dimensions).toContainEqual({ Name: 'ErrorType', Value: errorType });
      expect(dimensions).toContainEqual({ Name: 'FailedAtBatch', Value: '3' });
    });
  });

  describe('Episode Continuation Metrics', () => {
    it('should record episode continuation request', async () => {
      const userId = 'test-user-123';
      const storyId = 'story-456';

      await BusinessMetrics.recordEpisodeContinuation(userId, storyId);

      expect(mockSend).toHaveBeenCalledTimes(1);
      
      const call = mockSend.mock.calls[0];
      expect(call[0].input.MetricData[0].MetricName).toBe('EpisodeContinuations');
      expect(call[0].input.MetricData[0].Value).toBe(1);
      expect(call[0].input.MetricData[0].Unit).toBe('Count');
      
      // Verify dimensions
      const dimensions = call[0].input.MetricData[0].Dimensions;
      expect(dimensions).toContainEqual({ Name: 'UserId', Value: userId });
      expect(dimensions).toContainEqual({ Name: 'StoryId', Value: storyId });
    });

    it('should record episode continuation success with performance data', async () => {
      const userId = 'test-user-123';
      const storyId = 'story-456';
      const episodeNumber = 2;
      const duration = 45000; // 45 seconds

      await BusinessMetrics.recordEpisodeContinuationSuccess(
        userId,
        storyId,
        episodeNumber,
        duration
      );

      expect(mockSend).toHaveBeenCalledTimes(2);
      
      // Check success metric
      const successCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'EpisodeContinuationSuccess'
      );
      expect(successCall).toBeDefined();
      expect(successCall[0].input.MetricData[0].Value).toBe(1);
      
      // Check duration metric
      const durationCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'EpisodeContinuationDuration'
      );
      expect(durationCall).toBeDefined();
      expect(durationCall[0].input.MetricData[0].Value).toBe(45000);
      expect(durationCall[0].input.MetricData[0].Unit).toBe('Milliseconds');
      
      // Verify episode number dimension
      const dimensions = durationCall[0].input.MetricData[0].Dimensions;
      expect(dimensions).toContainEqual({ Name: 'EpisodeNumber', Value: '2' });
    });

    it('should record episode continuation failure with error details', async () => {
      const userId = 'test-user-123';
      const storyId = 'story-456';
      const errorType = 'STORY_NOT_FOUND';
      const episodeNumber = 3;

      await BusinessMetrics.recordEpisodeContinuationFailure(
        userId,
        storyId,
        errorType,
        episodeNumber
      );

      expect(mockSend).toHaveBeenCalledTimes(2);
      
      // Check failure metric
      const failureCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'EpisodeContinuationFailures'
      );
      expect(failureCall).toBeDefined();
      expect(failureCall[0].input.MetricData[0].Value).toBe(1);
      
      // Check error metric
      const errorCall = mockSend.mock.calls.find(call => 
        call[0].input.MetricData[0].MetricName === 'EpisodeContinuationErrors'
      );
      expect(errorCall).toBeDefined();
      expect(errorCall[0].input.MetricData[0].Value).toBe(1);
      
      // Verify error context dimensions
      const dimensions = errorCall[0].input.MetricData[0].Dimensions;
      expect(dimensions).toContainEqual({ Name: 'ErrorType', Value: errorType });
      expect(dimensions).toContainEqual({ Name: 'EpisodeNumber', Value: '3' });
    });
  });

  describe('Performance Timer', () => {
    it('should measure operation duration accurately', () => {
      const timer = new PerformanceTimer('TestOperation');
      
      // Simulate some processing time
      const startTime = Date.now();
      
      // Mock Date.now to simulate passage of time
      const mockNow = jest.spyOn(Date, 'now');
      mockNow.mockReturnValue(startTime + 1500); // 1.5 seconds later
      
      const duration = timer.stop();
      
      expect(duration).toBe(1500);
      
      mockNow.mockRestore();
    });

    it('should publish performance metric when stopped', async () => {
      const timer = new PerformanceTimer('TestOperation');
      
      // Mock Date.now to simulate passage of time
      const startTime = Date.now();
      const mockNow = jest.spyOn(Date, 'now');
      mockNow.mockReturnValue(startTime + 2000); // 2 seconds later
      
      const duration = await timer.stopAndPublish(
        'MangaPlatform/Performance',
        'TestOperationDuration',
        { Operation: 'Test' }
      );
      
      expect(duration).toBe(2000);
      expect(mockSend).toHaveBeenCalledTimes(1);
      
      const call = mockSend.mock.calls[0];
      expect(call[0].input.MetricData[0].MetricName).toBe('TestOperationDuration');
      expect(call[0].input.MetricData[0].Value).toBe(2000);
      expect(call[0].input.MetricData[0].Unit).toBe('Milliseconds');
      
      mockNow.mockRestore();
    });
  });

  describe('CloudWatch Metrics Integration', () => {
    it('should batch multiple metrics efficiently', async () => {
      const metrics = CloudWatchMetrics.getInstance();
      
      // Buffer multiple metrics
      metrics.bufferMetric('MangaPlatform/Business', 'TestMetric1', 1);
      metrics.bufferMetric('MangaPlatform/Business', 'TestMetric2', 2);
      metrics.bufferMetric('MangaPlatform/Performance', 'TestMetric3', 3, 'Milliseconds');
      
      // Flush all buffered metrics
      await metrics.flushMetrics();
      
      // Should have made 2 calls (one per namespace)
      expect(mockSend).toHaveBeenCalledTimes(2);
      
      // Verify business metrics call
      const businessCall = mockSend.mock.calls.find(call => 
        call[0].input.Namespace === 'MangaPlatform/Business'
      );
      expect(businessCall).toBeDefined();
      expect(businessCall[0].input.MetricData).toHaveLength(2);
      
      // Verify performance metrics call
      const performanceCall = mockSend.mock.calls.find(call => 
        call[0].input.Namespace === 'MangaPlatform/Performance'
      );
      expect(performanceCall).toBeDefined();
      expect(performanceCall[0].input.MetricData).toHaveLength(1);
    });

    it('should handle metric publishing errors gracefully', async () => {
      // Mock CloudWatch to throw an error
      mockSend.mockRejectedValueOnce(new Error('CloudWatch API Error'));
      
      // Should not throw error - metrics publishing should be non-blocking
      await expect(
        BusinessMetrics.recordWorkflowStart('test-user', 3)
      ).resolves.not.toThrow();
      
      expect(mockSend).toHaveBeenCalledTimes(2); // Two metrics in recordWorkflowStart
    });
  });

  describe('Metric Dimensions', () => {
    it('should include common dimensions in all metrics', async () => {
      await BusinessMetrics.recordWorkflowStart('test-user-123', 5);
      
      expect(mockSend).toHaveBeenCalled();
      
      const call = mockSend.mock.calls[0];
      const dimensions = call[0].input.MetricData[0].Dimensions;
      
      // Should include common dimensions
      expect(dimensions).toContainEqual({ 
        Name: 'Environment', 
        Value: process.env.ENVIRONMENT || 'dev' 
      });
      expect(dimensions).toContainEqual({ 
        Name: 'Service', 
        Value: 'manga-platform' 
      });
      
      // Should include specific dimensions
      expect(dimensions).toContainEqual({ 
        Name: 'UserId', 
        Value: 'test-user-123' 
      });
    });

    it('should handle optional dimensions correctly', async () => {
      // Test with optional episodeNumber
      await BusinessMetrics.recordEpisodeContinuationFailure(
        'test-user',
        'test-story',
        'TEST_ERROR'
        // episodeNumber omitted
      );
      
      expect(mockSend).toHaveBeenCalled();
      
      const call = mockSend.mock.calls[0];
      const dimensions = call[0].input.MetricData[0].Dimensions;
      
      // Should not include EpisodeNumber dimension when not provided
      const episodeNumberDimension = dimensions.find(d => d.Name === 'EpisodeNumber');
      expect(episodeNumberDimension).toBeUndefined();
    });
  });
});