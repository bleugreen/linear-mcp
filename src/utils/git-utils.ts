import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';

const execAsync = promisify(exec);

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: Date;
  body: string;
}

export interface GitDiff {
  additions: number;
  deletions: number;
  patch: string;
}

export class GitUtils {
  /**
   * Get commits that modified a specific file
   * @param filePath - Path to the file (relative or absolute)
   * @param limit - Maximum number of commits to return
   * @param since - Only get commits after this date (ISO string or relative date like '6.months.ago')
   */
  static async getFileHistory(
    filePath: string,
    limit: number = 100,
    since?: string
  ): Promise<GitCommit[]> {
    try {
      // Build git log command with format for easy parsing
      // Use a unique delimiter that won't appear in commit messages
      const delimiter = '|||DELIMITER|||';
      let cmd = `git log --follow --pretty=format:"%H${delimiter}%s${delimiter}%an${delimiter}%aI${delimiter}%b${delimiter}---END---" -n ${limit}`;
      
      if (since) {
        cmd += ` --since="${since}"`;
      }
      
      cmd += ` -- "${filePath}"`;
      
      const { stdout, stderr } = await execAsync(cmd);
      
      if (stderr) {
        logger.warn({ stderr, filePath }, 'Git log command produced warnings');
      }
      
      if (!stdout.trim()) {
        return [];
      }
      
      // Parse the git log output
      const commits: GitCommit[] = [];
      const rawCommits = stdout.split('---END---').filter(c => c.trim());
      
      for (const rawCommit of rawCommits) {
        const parts = rawCommit.trim().split(delimiter);
        if (parts.length >= 5) {
          const [sha, message, author, dateStr, body] = parts;
          commits.push({
            sha,
            message,
            author,
            date: new Date(dateStr),
            body: body.trim() || ''
          });
        }
      }
      
      return commits;
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to get file history');
      throw new Error(`Failed to get git history for ${filePath}: ${error}`);
    }
  }

  /**
   * Get the PR number associated with a commit
   * Uses GitHub CLI to find merged PRs that include the commit
   */
  static async getPRForCommit(sha: string): Promise<string | null> {
    try {
      // Use gh to search for PRs that include this commit
      const cmd = `gh pr list --state merged --search "${sha}" --json number,title,body --limit 1`;
      const { stdout, stderr } = await execAsync(cmd);
      
      // Check for gh CLI errors
      if (stderr && stderr.includes('error')) {
        logger.debug({ stderr }, 'GitHub CLI error, skipping PR lookup');
        return null;
      }
      
      if (!stdout.trim() || stdout === '[]') {
        return null;
      }
      
      const prs = JSON.parse(stdout);
      if (prs.length > 0) {
        return prs[0].number.toString();
      }
      
      return null;
    } catch (error: any) {
      // Don't warn for common errors like gh not being configured
      if (error.message?.includes('gh auth login') || error.message?.includes('authentication')) {
        logger.debug('GitHub CLI not authenticated, skipping PR lookup');
      } else {
        logger.warn({ error, sha }, 'Failed to get PR for commit');
      }
      return null;
    }
  }

  /**
   * Get PR details including description
   * @param prNumber - The PR number
   */
  static async getPRDetails(prNumber: string): Promise<{ title: string; body: string } | null> {
    try {
      const cmd = `gh pr view ${prNumber} --json title,body`;
      const { stdout } = await execAsync(cmd);
      
      if (!stdout.trim()) {
        return null;
      }
      
      return JSON.parse(stdout);
    } catch (error) {
      logger.warn({ error, prNumber }, 'Failed to get PR details');
      return null;
    }
  }

  /**
   * Check if we're in a git repository
   */
  static async isGitRepo(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --git-dir');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the repository root directory
   */
  static async getRepoRoot(): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --show-toplevel');
      return stdout.trim();
    } catch (error) {
      throw new Error('Not in a git repository');
    }
  }
}