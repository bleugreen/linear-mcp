import { IssueParser } from '../issue-parser';

describe('IssueParser', () => {
  describe('extractIssueReferences', () => {
    it('should extract standard Linear issue references', () => {
      const text = 'Fix auth issue (OPS-123) and update docs for FIRM-456';
      const references = IssueParser.extractIssueReferences(text);
      
      expect(references).toHaveLength(2);
      expect(references[0]).toEqual({
        identifier: 'OPS-123',
        team: 'OPS',
        number: 123
      });
      expect(references[1]).toEqual({
        identifier: 'FIRM-456',
        team: 'FIRM',
        number: 456
      });
    });

    it('should handle duplicate references', () => {
      const text = 'Working on OPS-123, related to OPS-123';
      const references = IssueParser.extractIssueReferences(text);
      
      expect(references).toHaveLength(1);
      expect(references[0].identifier).toBe('OPS-123');
    });

    it('should extract from multiple sources', () => {
      const sources = {
        commitMessage: 'Fix: Resolve auth issue (OPS-123)',
        commitBody: 'This also addresses FIRM-789',
        prTitle: 'Update authentication flow',
        prBody: 'Closes SOFT-456\n\nRelated to OPS-123'
      };
      
      const references = IssueParser.extractFromMultipleSources(sources);
      
      expect(references).toHaveLength(3);
      const identifiers = references.map(r => r.identifier);
      expect(identifiers).toContain('OPS-123');
      expect(identifiers).toContain('FIRM-789');
      expect(identifiers).toContain('SOFT-456');
    });
  });

  describe('containsClosingKeyword', () => {
    it('should detect closing keywords', () => {
      expect(IssueParser.containsClosingKeyword('Fixes OPS-123', 'OPS-123')).toBe(true);
      expect(IssueParser.containsClosingKeyword('This closes FIRM-456', 'FIRM-456')).toBe(true);
      expect(IssueParser.containsClosingKeyword('Resolves issue SOFT-789', 'SOFT-789')).toBe(true);
      expect(IssueParser.containsClosingKeyword('Related to OPS-123', 'OPS-123')).toBe(false);
    });
  });

  describe('extractWithGitHubReferences', () => {
    it('should extract GitHub-style references with default team', () => {
      const text = 'Fixes #123 and closes #456';
      const references = IssueParser.extractWithGitHubReferences(text, 'OPS');
      
      expect(references).toHaveLength(2);
      expect(references[0]).toEqual({
        identifier: 'OPS-123',
        team: 'OPS',
        number: 123
      });
      expect(references[1]).toEqual({
        identifier: 'OPS-456',
        team: 'OPS',
        number: 456
      });
    });

    it('should handle mixed references', () => {
      const text = 'Fixes #123 and FIRM-789';
      const references = IssueParser.extractWithGitHubReferences(text, 'OPS');
      
      expect(references).toHaveLength(2);
      const identifiers = references.map(r => r.identifier);
      expect(identifiers).toContain('OPS-123');
      expect(identifiers).toContain('FIRM-789');
    });
  });
});