import { logger } from './logger';

export interface IssueReference {
  identifier: string;
  team: string;
  number: number;
}

export class IssueParser {
  /**
   * Pattern to match Linear issue references
   * Supports formats like: OPS-123, FIRM-45, SOFT-789
   */
  private static readonly ISSUE_PATTERN = /\b([A-Z][A-Z0-9]*)-(\d+)\b/g;
  
  /**
   * Pattern to match GitHub issue references (#123)
   * These need context to determine the team
   */
  private static readonly GITHUB_ISSUE_PATTERN = /#(\d+)\b/g;

  /**
   * Extract Linear issue references from text
   * @param text - Text to parse (commit message, PR description, etc.)
   * @returns Array of unique issue references found
   */
  static extractIssueReferences(text: string): IssueReference[] {
    const references: IssueReference[] = [];
    const seen = new Set<string>();
    
    // Match standard Linear format (TEAM-123)
    let match;
    while ((match = this.ISSUE_PATTERN.exec(text)) !== null) {
      const identifier = match[0];
      const team = match[1];
      const number = parseInt(match[2], 10);
      
      if (!seen.has(identifier)) {
        seen.add(identifier);
        references.push({ identifier, team, number });
      }
    }
    
    // Reset regex lastIndex
    this.ISSUE_PATTERN.lastIndex = 0;
    
    return references;
  }

  /**
   * Extract issue references from multiple sources
   * Combines references from commit message, commit body, and PR description
   * @param sources - Object containing different text sources
   * @returns Array of unique issue references
   */
  static extractFromMultipleSources(sources: {
    commitMessage?: string;
    commitBody?: string;
    prTitle?: string;
    prBody?: string;
  }): IssueReference[] {
    const allReferences: IssueReference[] = [];
    const seen = new Set<string>();
    
    // Process each source
    const textsToProcess = [
      sources.commitMessage,
      sources.commitBody,
      sources.prTitle,
      sources.prBody
    ].filter(Boolean) as string[];
    
    for (const text of textsToProcess) {
      const refs = this.extractIssueReferences(text);
      for (const ref of refs) {
        if (!seen.has(ref.identifier)) {
          seen.add(ref.identifier);
          allReferences.push(ref);
        }
      }
    }
    
    logger.debug({ 
      sources: Object.keys(sources).filter(k => sources[k as keyof typeof sources]), 
      foundReferences: allReferences.length 
    }, 'Extracted issue references');
    
    return allReferences;
  }

  /**
   * Check if text contains closing keywords for issues
   * Common patterns: "Fixes OPS-123", "Closes #456", "Resolves FIRM-89"
   */
  static containsClosingKeyword(text: string, issueIdentifier: string): boolean {
    const closingKeywords = [
      'close', 'closes', 'closed',
      'fix', 'fixes', 'fixed',
      'resolve', 'resolves', 'resolved'
    ];
    
    const pattern = new RegExp(
      `\\b(${closingKeywords.join('|')})\\s+${issueIdentifier}\\b`,
      'i'
    );
    
    return pattern.test(text);
  }

  /**
   * Parse GitHub-style issue references with team context
   * This is useful when we know the default team from context
   * @param text - Text to parse
   * @param defaultTeam - Default team to use for #123 style references
   */
  static extractWithGitHubReferences(
    text: string, 
    defaultTeam?: string
  ): IssueReference[] {
    const references = this.extractIssueReferences(text);
    
    if (defaultTeam) {
      // Also look for GitHub-style references
      let match;
      while ((match = this.GITHUB_ISSUE_PATTERN.exec(text)) !== null) {
        const number = parseInt(match[1], 10);
        const identifier = `${defaultTeam}-${number}`;
        
        // Check if we already have this reference
        if (!references.some(ref => ref.identifier === identifier)) {
          references.push({
            identifier,
            team: defaultTeam,
            number
          });
        }
      }
      
      // Reset regex lastIndex
      this.GITHUB_ISSUE_PATTERN.lastIndex = 0;
    }
    
    return references;
  }
}