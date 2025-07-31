/**
 * Integration tests for EventBridge workflow event publishing
 * Tests the complete flow of batch and continue episode workflows
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  EventPublisher,
  EventPublishingHelpers,
  WorkflowEventPublisher,
} from '../utils/event-publisher';
import {
  EventSchemaValidator,
  BatchWorkflowEvent,
  ContinueEpisodeEvent,
  BatchWorkflowStatusEvent,
  EpisodeContinuationStatusEvent,
} from '../types/event-schemas';

// Mock AWS SDK
jest.mock('@aws-sdk/client-eventbridge');
const mockEventBridgeClient = EventBridgeClient as jest.MockedClass<typeof EventBridgeClient>;
const mockSend = jest.fn();

describe('Event Workflow Integration Tests', () => {
  let eventPublisher: EventPublisher;
  let workflowPublisher: WorkflowEventPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventBridgeClient.mockImplementation(() => ({
      send: mockSend,
    }) as any);

    mockSend.mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [{ EventId: 'test-event-id' }],
    });

    eventPublisher = new EventPublisher('test-event-bus');
    workflowPublisher = new WorkflowEventPublisher(eventPublisher);
  });

  describe('Batch Workflow Complete Flow', () => {
    it('should handle complete batch workflow lifecycle', async () => {
      const userId = 'user-123';
      const workflowId = 'workflow-456';
      const requestId = 'request-789';
      const numberOfStories = 3;

      // 1. Start workflow
      await workflowPublisher.publishWorkflowStart(
        userId,
        workflowId,
        requestId,
        numberOfStories
      );

      // 2. Publish batch story generation events
      for (let batch = 1; batch <= numberOfStories; batch++) {
        await EventPublishingHelpers.publishBatchStoryGeneration(
          userId,
          workflowId,
          `${requestId}-batch-${batch}`,
          numberOfStories,
          batch,
          numberOfStories,
          { genres: ['action'], themes: ['friendship'] },
          { recommendations: [], trends: [] }
        );
      }

      // 3. Publish story completion events
      for (let batch = 1; batch <= numberOfStories; batch++) {
        await EventPublishingHelpers.publishBatchStoryCompletion(
          userId,
          workflowId,
          `story-${batch}`,
          batch,
          numberOfStories,
          batch === numberOfStories
        );
      }

      // 4. Update workflow progress
      await workflowPublisher.publishWorkflowProgress(
        userId,
        workflowId,
        requestId,
        numberOfStories,
        numberOfStories,
        numberOfStories,
        0
      );

      // 5. Complete workflow
      await workflowPublisher.publishWorkflowCompletion(
        userId,
        workflowId,
        requestId,
        numberOfStories,
        numberOfStories,
        0
      );

      // Verify all events were published
      expect(mockSend).toHaveBeenCalledTimes(9); // 1 start + 3 batch + 3 completion + 1 progress + 1 complete

      // Verify event types
      const calls = mockSend.mock.calls;
      const eventTypes = calls.map(call => call[0].Entries[0].DetailType);

      expect(eventTypes).toContain('Batch Workflow Status Updated');
      expect(eventTypes).toContain('Batch Story Generation Requested');
      expect(eventTypes).toContain('Batch Story Completed');
    });

    it('should handle batch workflow with failures', async () => {
      const userId = 'user-123';
      const workflowId = 'workflow-456';
      const requestId = 'request-789';

      // Simulate workflow with some failures
      await EventPublishingHelpers.publishBatchWorkflowStatus(
        userId,
        workflowId,
        requestId,
        'IN_PROGRESS',
        2,
        3,
        1,
        1,
        'Story generation failed for batch 2'
      );

      // Continue with next batch despite failure
      await EventPublishingHelpers.publishBatchStoryGeneration(
        userId,
        workflowId,
        `${requestId}-batch-3`,
        3,
        3,
        3,
        { genres: ['action'] },
        { recommendations: [] }
      );

      // Complete workflow with mixed results
      await workflowPublisher.publishWorkflowCompletion(
        userId,
        workflowId,
        requestId,
        3,
        2,
        1
      );

      expect(mockSend).toHaveBeenCalledTimes(3);

      // Verify error message was included
      const statusCall = mockSend.mock.calls[0];
      const statusDetail = JSON.parse(statusCall[0].Entries[0].Detail);
      expect(statusDetail.errorMessage).toBe('Story generation failed for batch 2');
      expect(statusDetail.failedStories).toBe(1);
    });
  });

  describe('Continue Episode Complete Flow', () => {
    it('should handle complete episode continuation lifecycle', async () => {
      const userId = 'user-123';
      const storyId = 'story-456';
      const episodeId = 'episode-789';
      const episodeNumber = 2;

      // 1. Request episode continuation
      await workflowPublisher.publishEpisodeContinuationRequest(
        userId,
        storyId,
        episodeId,
        episodeNumber
      );

      // 2. Publish continue episode event
      await EventPublishingHelpers.publishContinueEpisode(
        userId,
        storyId,
        episodeNumber,
        { genres: ['action'], themes: ['friendship'] },
        'stories/user-123/story-456.md'
      );

      // 3. Update episode status to generating
      await EventPublishingHelpers.publishEpisodeContinuationStatus(
        userId,
        storyId,
        episodeId,
        episodeNumber,
        'GENERATING'
      );

      // 4. Complete episode generation
      await EventPublishingHelpers.publishEpisodeContinuationStatus(
        userId,
        storyId,
        episodeId,
        episodeNumber,
        'COMPLETED'
      );

      expect(mockSend).toHaveBeenCalledTimes(4);

      // Verify event progression
      const calls = mockSend.mock.calls;
      const statusUpdates = calls
        .filter(call => call[0].Entries[0].DetailType === 'Episode Continuation Status Updated')
        .map(call => JSON.parse(call[0].Entries[0].Detail).status);

      expect(statusUpdates).toEqual(['REQUESTED', 'GENERATING', 'COMPLETED']);
    });

    it('should handle episode continuation failure', async () => {
      const userId = 'user-123';
      const storyId = 'story-456';
      const episodeId = 'episode-789';
      const episodeNumber = 2;

      // Start episode continuation
      await EventPublishingHelpers.publishEpisodeContinuationStatus(
        userId,
        storyId,
        episodeId,
        episodeNumber,
        'GENERATING'
      );

      // Fail episode generation
      await EventPublishingHelpers.publishEpisodeContinuationStatus(
        userId,
        storyId,
        episodeId,
        episodeNumber,
        'FAILED',
        'Bedrock API timeout'
      );

      expect(mockSend).toHaveBeenCalledTimes(2);

      // Verify error message was included
      const failureCall = mockSend.mock.calls[1];
      const failureDetail = JSON.parse(failureCall[0].Entries[0].Detail);
      expect(failureDetail.status).toBe('FAILED');
      expect(failureDetail.errorMessage).toBe('Bedrock API timeout');
    });
  });

  describe('Event Validation Integration', () => {
    it('should validate events before publishing in workflow', async () => {
      // Try to publish invalid batch workflow event
      const invalidEvent: BatchWorkflowEvent = {
        source: 'manga.workflow',
        'detail-type': 'Batch Story Generation Requested',
        detail: {
          userId: '', // Invalid
          workflowId: 'workflow-456',
          requestId: 'request-789',
          numberOfStories: 15, // Invalid: exceeds max
          currentBatch: 1,
          totalBatches: 5,
          preferences: {} as any,
          insights: {} as any,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      };

      await expect(eventPublisher.publishEvent(invalidEvent)).rejects.toThrow(
        'Event validation failed'
      );

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should validate continue episode events', async () => {
      const invalidEvent: ContinueEpisodeEvent = {
        source: 'manga.story',
        'detail-type': 'Continue Episode Requested',
        detail: {
          userId: 'user-123',
          storyId: '', // Invalid
          nextEpisodeNumber: 0, // Invalid
          originalPreferences: null as any, // Invalid
          storyS3Key: 'stories/user-123/story-456.md',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      };

      await expect(eventPublisher.publishEvent(invalidEvent)).rejects.toThrow(
        'Event validation failed'
      );

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle EventBridge service errors gracefully', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'ValidationException', ErrorMessage: 'Invalid event format' }],
      });

      await expect(
        workflowPublisher.publishWorkflowStart('user-123', 'workflow-456', 'request-789', 5)
      ).rejects.toThrow('Failed to publish event');
    });

    it('should handle network errors during workflow publishing', async () => {
      mockSend.mockRejectedValue(new Error('Network timeout'));

      await expect(
        EventPublishingHelpers.publishBatchStoryGeneration(
          'user-123',
          'workflow-456',
          'request-789',
          3,
          1,
          3,
          { genres: ['action'] },
          { recommendations: [] }
        )
      ).rejects.toThrow('Network timeout');
    });

    it('should handle partial batch failures', async () => {
      const events = [
        {
          source: 'manga.workflow',
          'detail-type': 'Batch Story Generation Requested',
          detail: {
            userId: 'user-123',
            workflowId: 'workflow-456',
            requestId: 'request-789',
            numberOfStories: 2,
            currentBatch: 1,
            totalBatches: 2,
            preferences: { genres: ['action'] },
            insights: { recommendations: [] },
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          source: 'manga.workflow',
          'detail-type': 'Batch Story Generation Requested',
          detail: {
            userId: 'user-123',
            workflowId: 'workflow-456',
            requestId: 'request-789',
            numberOfStories: 2,
            currentBatch: 2,
            totalBatches: 2,
            preferences: { genres: ['action'] },
            insights: { recommendations: [] },
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        },
      ] as any[];

      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [
          { EventId: 'success-1' },
          { ErrorCode: 'ValidationException', ErrorMessage: 'Invalid second event' },
        ],
      });

      await expect(eventPublisher.publishEvents(events)).rejects.toThrow(
        'Failed to publish 1 events'
      );
    });
  });

  describe('Event Schema Validation Edge Cases', () => {
    it('should handle edge case validation scenarios', async () => {
      // Test boundary values
      const boundaryEvent: BatchWorkflowEvent = {
        source: 'manga.workflow',
        'detail-type': 'Batch Story Generation Requested',
        detail: {
          userId: 'user-123',
          workflowId: 'workflow-456',
          requestId: 'request-789',
          numberOfStories: 10, // Max allowed
          currentBatch: 1,
          totalBatches: 10,
          preferences: { genres: ['action'] },
          insights: { recommendations: [] },
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      };

      await eventPublisher.publishEvent(boundaryEvent);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should validate complex nested objects', async () => {
      const complexEvent: ContinueEpisodeEvent = {
        source: 'manga.story',
        'detail-type': 'Continue Episode Requested',
        detail: {
          userId: 'user-123',
          storyId: 'story-456',
          nextEpisodeNumber: 5,
          originalPreferences: {
            genres: ['action', 'adventure', 'fantasy'],
            themes: ['friendship', 'courage', 'growth'],
            artStyle: 'manga',
            targetAudience: 'teen',
            contentRating: 'PG-13',
            additionalSettings: {
              pacing: 'fast',
              complexity: 'medium',
            },
          },
          storyS3Key: 'stories/user-123/story-456.md',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      };

      await eventPublisher.publishEvent(complexEvent);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const sentDetail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
      expect(sentDetail.originalPreferences.genres).toHaveLength(3);
      expect(sentDetail.originalPreferences.additionalSettings.pacing).toBe('fast');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle maximum batch size efficiently', async () => {
      const maxEvents = Array.from({ length: 10 }, (_, i) => ({
        source: 'manga.workflow',
        'detail-type': 'Batch Story Generation Requested',
        detail: {
          userId: 'user-123',
          workflowId: 'workflow-456',
          requestId: `request-${i}`,
          numberOfStories: 1,
          currentBatch: i + 1,
          totalBatches: 10,
          preferences: { genres: ['action'] },
          insights: { recommendations: [] },
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      })) as any[];

      await eventPublisher.publishEvents(maxEvents);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0].Entries).toHaveLength(10);
    });

    it('should reject oversized batches', async () => {
      const oversizedEvents = Array.from({ length: 11 }, (_, i) => ({
        source: 'manga.workflow',
        'detail-type': 'Batch Story Generation Requested',
        detail: {
          userId: 'user-123',
          workflowId: 'workflow-456',
          requestId: `request-${i}`,
          numberOfStories: 1,
          currentBatch: i + 1,
          totalBatches: 11,
          preferences: { genres: ['action'] },
          insights: { recommendations: [] },
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      })) as any[];

      await expect(eventPublisher.publishEvents(oversizedEvents)).rejects.toThrow(
        'Cannot publish more than 10 events in a single batch'
      );

      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});