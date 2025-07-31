/**
 * Unit tests for EventBridge event publisher workflow functionality
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  EventPublisher,
  EventPublishingHelpers,
  WorkflowEventPublisher,
  workflowEventPublisher,
} from '../event-publisher';
import {
  BatchWorkflowEvent,
  BatchWorkflowStatusEvent,
  BatchStoryCompletionEvent,
  ContinueEpisodeEvent,
  EpisodeContinuationStatusEvent,
} from '../../types/event-schemas';

// Mock AWS SDK
jest.mock('@aws-sdk/client-eventbridge');
const mockEventBridgeClient = EventBridgeClient as jest.MockedClass<typeof EventBridgeClient>;
const mockSend = jest.fn();

describe('EventPublisher - Workflow Events', () => {
  let eventPublisher: EventPublisher;

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
  });

  describe('publishBatchWorkflowStatusEvent', () => {
    it('should publish batch workflow status event successfully', async () => {
      const eventDetail = {
        userId: 'user-123',
        workflowId: 'workflow-456',
        requestId: 'request-789',
        status: 'IN_PROGRESS' as const,
        currentBatch: 2,
        totalBatches: 5,
        completedStories: 1,
        failedStories: 0,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      await eventPublisher.publishBatchWorkflowStatusEvent(eventDetail);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Source: 'manga.workflow',
              DetailType: 'Batch Workflow Status Updated',
              Detail: JSON.stringify(eventDetail),
              EventBusName: 'test-event-bus',
            }),
          ],
        })
      );
    });

    it('should add timestamp if not provided', async () => {
      const eventDetail = {
        userId: 'user-123',
        workflowId: 'workflow-456',
        requestId: 'request-789',
        status: 'COMPLETED' as const,
        currentBatch: 5,
        totalBatches: 5,
        completedStories: 5,
        failedStories: 0,
      };

      await eventPublisher.publishBatchWorkflowStatusEvent(eventDetail);

      const sentDetail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
      expect(sentDetail.timestamp).toBeDefined();
      expect(new Date(sentDetail.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('publishBatchStoryCompletionEvent', () => {
    it('should publish batch story completion event successfully', async () => {
      const eventDetail = {
        userId: 'user-123',
        workflowId: 'workflow-456',
        storyId: 'story-789',
        batchNumber: 3,
        totalBatches: 5,
        isLastStory: false,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      await eventPublisher.publishBatchStoryCompletionEvent(eventDetail);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Source: 'manga.workflow',
              DetailType: 'Batch Story Completed',
              Detail: JSON.stringify(eventDetail),
            }),
          ],
        })
      );
    });
  });

  describe('publishEpisodeContinuationStatusEvent', () => {
    it('should publish episode continuation status event successfully', async () => {
      const eventDetail = {
        userId: 'user-123',
        storyId: 'story-456',
        episodeId: 'episode-789',
        episodeNumber: 2,
        status: 'GENERATING' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      await eventPublisher.publishEpisodeContinuationStatusEvent(eventDetail);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Source: 'manga.episode',
              DetailType: 'Episode Continuation Status Updated',
              Detail: JSON.stringify(eventDetail),
            }),
          ],
        })
      );
    });
  });

  describe('publishEvent with validation', () => {
    it('should validate event before publishing', async () => {
      const invalidEvent: BatchWorkflowEvent = {
        source: 'manga.workflow',
        'detail-type': 'Batch Story Generation Requested',
        detail: {
          userId: '', // Invalid: empty string
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

    it('should publish valid event successfully', async () => {
      const validEvent: ContinueEpisodeEvent = {
        source: 'manga.story',
        'detail-type': 'Continue Episode Requested',
        detail: {
          userId: 'user-123',
          storyId: 'story-456',
          nextEpisodeNumber: 2,
          originalPreferences: {
            genres: ['action'],
            themes: ['friendship'],
            artStyle: 'manga',
            targetAudience: 'teen',
            contentRating: 'PG-13',
          },
          storyS3Key: 'stories/user-123/story-456.md',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      };

      await eventPublisher.publishEvent(validEvent);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Source: 'manga.story',
              DetailType: 'Continue Episode Requested',
            }),
          ],
        })
      );
    });
  });

  describe('publishEvents with batch validation', () => {
    it('should validate all events in batch before publishing', async () => {
      const events = [
        {
          source: 'manga.workflow',
          'detail-type': 'Batch Story Generation Requested',
          detail: {
            userId: 'user-123',
            workflowId: 'workflow-456',
            requestId: 'request-789',
            numberOfStories: 3,
            currentBatch: 1,
            totalBatches: 3,
            preferences: { genres: ['action'] },
            insights: { recommendations: [] },
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          source: 'manga.workflow',
          'detail-type': 'Batch Story Generation Requested',
          detail: {
            userId: '', // Invalid
            workflowId: 'workflow-456',
            requestId: 'request-789',
            numberOfStories: 3,
            currentBatch: 2,
            totalBatches: 3,
            preferences: { genres: ['action'] },
            insights: { recommendations: [] },
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        },
      ] as any[];

      await expect(eventPublisher.publishEvents(events)).rejects.toThrow(
        'Batch event validation failed'
      );

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should publish valid batch events successfully', async () => {
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

      await eventPublisher.publishEvents(events);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: expect.arrayContaining([
            expect.objectContaining({
              Source: 'manga.workflow',
              DetailType: 'Batch Story Generation Requested',
            }),
          ]),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle EventBridge failures', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'ValidationException', ErrorMessage: 'Invalid event' }],
      });

      const eventDetail = {
        userId: 'user-123',
        workflowId: 'workflow-456',
        requestId: 'request-789',
        status: 'STARTED' as const,
        currentBatch: 1,
        totalBatches: 5,
        completedStories: 0,
        failedStories: 0,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      await expect(
        eventPublisher.publishBatchWorkflowStatusEvent(eventDetail)
      ).rejects.toThrow('Failed to publish event');
    });

    it('should handle network errors', async () => {
      mockSend.mockRejectedValue(new Error('Network error'));

      const eventDetail = {
        userId: 'user-123',
        workflowId: 'workflow-456',
        storyId: 'story-789',
        batchNumber: 1,
        totalBatches: 5,
        isLastStory: false,
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      await expect(
        eventPublisher.publishBatchStoryCompletionEvent(eventDetail)
      ).rejects.toThrow('Failed to publish event');
    });
  });
});

describe('EventPublishingHelpers - Workflow Methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [{ EventId: 'test-event-id' }],
    });
  });

  describe('publishBatchWorkflowStatus', () => {
    it('should publish batch workflow status with all parameters', async () => {
      await EventPublishingHelpers.publishBatchWorkflowStatus(
        'user-123',
        'workflow-456',
        'request-789',
        'IN_PROGRESS',
        2,
        5,
        1,
        0,
        'Optional error message'
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Source: 'manga.workflow',
              DetailType: 'Batch Workflow Status Updated',
            }),
          ],
        })
      );
    });

    it('should handle errors gracefully', async () => {
      mockSend.mockRejectedValue(new Error('EventBridge error'));

      await expect(
        EventPublishingHelpers.publishBatchWorkflowStatus(
          'user-123',
          'workflow-456',
          'request-789',
          'FAILED',
          1,
          5,
          0,
          1
        )
      ).rejects.toThrow('EventBridge error');
    });
  });

  describe('publishEpisodeContinuationStatus', () => {
    it('should publish episode continuation status successfully', async () => {
      await EventPublishingHelpers.publishEpisodeContinuationStatus(
        'user-123',
        'story-456',
        'episode-789',
        2,
        'COMPLETED'
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Source: 'manga.episode',
              DetailType: 'Episode Continuation Status Updated',
            }),
          ],
        })
      );
    });

    it('should include error message when provided', async () => {
      await EventPublishingHelpers.publishEpisodeContinuationStatus(
        'user-123',
        'story-456',
        'episode-789',
        2,
        'FAILED',
        'Generation failed due to timeout'
      );

      const sentDetail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
      expect(sentDetail.errorMessage).toBe('Generation failed due to timeout');
    });
  });
});

describe('WorkflowEventPublisher', () => {
  let workflowPublisher: WorkflowEventPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [{ EventId: 'test-event-id' }],
    });

    workflowPublisher = new WorkflowEventPublisher();
  });

  describe('publishWorkflowStart', () => {
    it('should publish workflow start event', async () => {
      await workflowPublisher.publishWorkflowStart(
        'user-123',
        'workflow-456',
        'request-789',
        5
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Source: 'manga.workflow',
              DetailType: 'Batch Workflow Status Updated',
            }),
          ],
        })
      );

      const sentDetail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
      expect(sentDetail.status).toBe('STARTED');
      expect(sentDetail.currentBatch).toBe(0);
      expect(sentDetail.totalBatches).toBe(5);
    });
  });

  describe('publishWorkflowProgress', () => {
    it('should publish workflow progress event', async () => {
      await workflowPublisher.publishWorkflowProgress(
        'user-123',
        'workflow-456',
        'request-789',
        3,
        5,
        2,
        1
      );

      const sentDetail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
      expect(sentDetail.status).toBe('IN_PROGRESS');
      expect(sentDetail.currentBatch).toBe(3);
      expect(sentDetail.completedStories).toBe(2);
      expect(sentDetail.failedStories).toBe(1);
    });
  });

  describe('publishWorkflowCompletion', () => {
    it('should publish workflow completion event', async () => {
      await workflowPublisher.publishWorkflowCompletion(
        'user-123',
        'workflow-456',
        'request-789',
        5,
        4,
        1
      );

      const sentDetail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
      expect(sentDetail.status).toBe('COMPLETED');
      expect(sentDetail.currentBatch).toBe(5);
      expect(sentDetail.totalBatches).toBe(5);
      expect(sentDetail.completedStories).toBe(4);
      expect(sentDetail.failedStories).toBe(1);
    });
  });

  describe('publishEpisodeContinuationRequest', () => {
    it('should publish episode continuation request', async () => {
      await workflowPublisher.publishEpisodeContinuationRequest(
        'user-123',
        'story-456',
        'episode-789',
        2
      );

      const sentDetail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
      expect(sentDetail.status).toBe('REQUESTED');
      expect(sentDetail.episodeNumber).toBe(2);
    });
  });
});

describe('Singleton instances', () => {
  it('should provide singleton workflow event publisher', () => {
    expect(workflowEventPublisher).toBeInstanceOf(WorkflowEventPublisher);
  });
});