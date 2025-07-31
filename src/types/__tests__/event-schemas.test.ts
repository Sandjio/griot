/**
 * Unit tests for EventBridge event schemas and validation
 */

import {
  EventSchemaValidator,
  BatchWorkflowEventDetail,
  ContinueEpisodeEventDetail,
  BatchWorkflowStatusEventDetail,
  EpisodeContinuationStatusEventDetail,
  BatchWorkflowEvent,
  ContinueEpisodeEvent,
  BatchWorkflowStatusEvent,
  EpisodeContinuationStatusEvent,
} from '../event-schemas';

describe('EventSchemaValidator', () => {
  describe('validateBatchWorkflowEvent', () => {
    const validBatchWorkflowDetail: BatchWorkflowEventDetail = {
      userId: 'user-123',
      workflowId: 'workflow-456',
      requestId: 'request-789',
      numberOfStories: 5,
      currentBatch: 1,
      totalBatches: 5,
      preferences: {
        genres: ['action', 'adventure'],
        themes: ['friendship'],
        artStyle: 'manga',
        targetAudience: 'teen',
        contentRating: 'PG-13',
      },
      insights: {
        recommendations: [],
        trends: [],
      },
      timestamp: '2024-01-01T00:00:00.000Z',
    };

    it('should validate a valid batch workflow event', () => {
      const result = EventSchemaValidator.validateBatchWorkflowEvent(validBatchWorkflowDetail);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing userId', () => {
      const invalid = { ...validBatchWorkflowDetail, userId: undefined };
      const result = EventSchemaValidator.validateBatchWorkflowEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('userId is required and must be a string');
    });

    it('should reject invalid numberOfStories', () => {
      const invalid = { ...validBatchWorkflowDetail, numberOfStories: 15 };
      const result = EventSchemaValidator.validateBatchWorkflowEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('numberOfStories must be a number between 1 and 10');
    });

    it('should reject negative currentBatch', () => {
      const invalid = { ...validBatchWorkflowDetail, currentBatch: 0 };
      const result = EventSchemaValidator.validateBatchWorkflowEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('currentBatch must be a positive number');
    });

    it('should reject missing preferences', () => {
      const invalid = { ...validBatchWorkflowDetail, preferences: undefined };
      const result = EventSchemaValidator.validateBatchWorkflowEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('preferences is required and must be an object');
    });
  });

  describe('validateContinueEpisodeEvent', () => {
    const validContinueEpisodeDetail: ContinueEpisodeEventDetail = {
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
    };

    it('should validate a valid continue episode event', () => {
      const result = EventSchemaValidator.validateContinueEpisodeEvent(validContinueEpisodeDetail);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing storyId', () => {
      const invalid = { ...validContinueEpisodeDetail, storyId: '' };
      const result = EventSchemaValidator.validateContinueEpisodeEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('storyId is required and must be a string');
    });

    it('should reject invalid nextEpisodeNumber', () => {
      const invalid = { ...validContinueEpisodeDetail, nextEpisodeNumber: 0 };
      const result = EventSchemaValidator.validateContinueEpisodeEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('nextEpisodeNumber must be a positive number');
    });

    it('should reject missing originalPreferences', () => {
      const invalid = { ...validContinueEpisodeDetail, originalPreferences: null };
      const result = EventSchemaValidator.validateContinueEpisodeEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('originalPreferences is required and must be an object');
    });
  });

  describe('validateBatchWorkflowStatusEvent', () => {
    const validStatusDetail: BatchWorkflowStatusEventDetail = {
      userId: 'user-123',
      workflowId: 'workflow-456',
      requestId: 'request-789',
      status: 'IN_PROGRESS',
      currentBatch: 2,
      totalBatches: 5,
      completedStories: 1,
      failedStories: 0,
      timestamp: '2024-01-01T00:00:00.000Z',
    };

    it('should validate a valid batch workflow status event', () => {
      const result = EventSchemaValidator.validateBatchWorkflowStatusEvent(validStatusDetail);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid status', () => {
      const invalid = { ...validStatusDetail, status: 'INVALID_STATUS' };
      const result = EventSchemaValidator.validateBatchWorkflowStatusEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('status must be one of: STARTED, IN_PROGRESS, COMPLETED, FAILED, CANCELLED');
    });

    it('should reject negative completedStories', () => {
      const invalid = { ...validStatusDetail, completedStories: -1 };
      const result = EventSchemaValidator.validateBatchWorkflowStatusEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('completedStories must be a non-negative number');
    });
  });

  describe('validateEpisodeContinuationStatusEvent', () => {
    const validEpisodeStatusDetail: EpisodeContinuationStatusEventDetail = {
      userId: 'user-123',
      storyId: 'story-456',
      episodeId: 'episode-789',
      episodeNumber: 2,
      status: 'GENERATING',
      timestamp: '2024-01-01T00:00:00.000Z',
    };

    it('should validate a valid episode continuation status event', () => {
      const result = EventSchemaValidator.validateEpisodeContinuationStatusEvent(validEpisodeStatusDetail);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid status', () => {
      const invalid = { ...validEpisodeStatusDetail, status: 'INVALID' };
      const result = EventSchemaValidator.validateEpisodeContinuationStatusEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('status must be one of: REQUESTED, GENERATING, COMPLETED, FAILED');
    });

    it('should reject missing episodeId', () => {
      const invalid = { ...validEpisodeStatusDetail, episodeId: '' };
      const result = EventSchemaValidator.validateEpisodeContinuationStatusEvent(invalid);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('episodeId is required and must be a string');
    });
  });

  describe('validateEvent', () => {
    it('should validate batch workflow event', () => {
      const event: BatchWorkflowEvent = {
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
      };

      const result = EventSchemaValidator.validateEvent(event);
      expect(result.isValid).toBe(true);
    });

    it('should validate continue episode event', () => {
      const event: ContinueEpisodeEvent = {
        source: 'manga.story',
        'detail-type': 'Continue Episode Requested',
        detail: {
          userId: 'user-123',
          storyId: 'story-456',
          nextEpisodeNumber: 2,
          originalPreferences: { genres: ['action'] },
          storyS3Key: 'stories/user-123/story-456.md',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      };

      const result = EventSchemaValidator.validateEvent(event);
      expect(result.isValid).toBe(true);
    });

    it('should skip validation for unknown event types', () => {
      const event = {
        source: 'manga.unknown',
        'detail-type': 'Unknown Event Type',
        detail: { someField: 'someValue' },
      } as any;

      const result = EventSchemaValidator.validateEvent(event);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe('Event Type Definitions', () => {
  it('should have correct structure for BatchWorkflowEvent', () => {
    const event: BatchWorkflowEvent = {
      source: 'manga.workflow',
      'detail-type': 'Batch Story Generation Requested',
      detail: {
        userId: 'user-123',
        workflowId: 'workflow-456',
        requestId: 'request-789',
        numberOfStories: 5,
        currentBatch: 1,
        totalBatches: 5,
        preferences: {
          genres: ['action'],
          themes: ['friendship'],
          artStyle: 'manga',
          targetAudience: 'teen',
          contentRating: 'PG-13',
        },
        insights: {
          recommendations: [],
          trends: [],
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    };

    expect(event.source).toBe('manga.workflow');
    expect(event['detail-type']).toBe('Batch Story Generation Requested');
    expect(event.detail.userId).toBe('user-123');
    expect(event.detail.numberOfStories).toBe(5);
  });

  it('should have correct structure for BatchWorkflowStatusEvent', () => {
    const event: BatchWorkflowStatusEvent = {
      source: 'manga.workflow',
      'detail-type': 'Batch Workflow Status Updated',
      detail: {
        userId: 'user-123',
        workflowId: 'workflow-456',
        requestId: 'request-789',
        status: 'IN_PROGRESS',
        currentBatch: 2,
        totalBatches: 5,
        completedStories: 1,
        failedStories: 0,
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    };

    expect(event.source).toBe('manga.workflow');
    expect(event['detail-type']).toBe('Batch Workflow Status Updated');
    expect(event.detail.status).toBe('IN_PROGRESS');
    expect(event.detail.completedStories).toBe(1);
  });

  it('should have correct structure for EpisodeContinuationStatusEvent', () => {
    const event: EpisodeContinuationStatusEvent = {
      source: 'manga.episode',
      'detail-type': 'Episode Continuation Status Updated',
      detail: {
        userId: 'user-123',
        storyId: 'story-456',
        episodeId: 'episode-789',
        episodeNumber: 2,
        status: 'COMPLETED',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    };

    expect(event.source).toBe('manga.episode');
    expect(event['detail-type']).toBe('Episode Continuation Status Updated');
    expect(event.detail.episodeNumber).toBe(2);
    expect(event.detail.status).toBe('COMPLETED');
  });
});