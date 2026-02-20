import { Injectable } from '@angular/core';

export interface YamlLine {
  content: string;
  level: number;
  lineNumber: number;
  rangeStart: number;
  rangeEnd: number;
  hasChildren: boolean;
  isExpandable: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class YamlParserService {

  parseYamlToLines(yamlText: string): YamlLine[] {
    const lines = yamlText.split('\n');
    const parsedLines: YamlLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue; // Skip empty lines

      const level = this.getIndentationLevel(line);
      const hasChildren = this.checkHasChildren(lines, i);
      const range = this.calculateRange(lines, i, level);

      parsedLines.push({
        content: line,
        level,
        lineNumber: i,
        rangeStart: range.start,
        rangeEnd: range.end,
        hasChildren,
        isExpandable: hasChildren
      });
    }

    return parsedLines;
  }

  private getIndentationLevel(line: string): number {
    const match = line.match(/^(\s*)/);
    if (!match) return 0;

    const spaces = match[1].length;
    const trimmedLine = line.trim();

    // kubectl describe format detection:
    // A line without a colon is likely a multi-line value continuation
    const hasColon = trimmedLine.includes(':');
    const isLikelyContinuation = !hasColon && spaces > 0;
    const isArrayItem = trimmedLine.startsWith('- ');

    let level = 0;
    if (isArrayItem) {
      // Array items sit half a level deeper than their parent at the same indent
      // e.g. "clusterIPs:" (2 spaces) and "- 10.96.96.125" (2 spaces)
      level = spaces + 0.5;
    } else if (isLikelyContinuation) {
      // Continuation lines get a moderate sub-level, capped to avoid deep nesting
      level = Math.min(spaces, 10);
    } else {
      // Use raw indent as level
      level = spaces;
    }

    return level;
  }

  private checkHasChildren(lines: string[], currentIndex: number): boolean {
    if (currentIndex >= lines.length - 1) return false;

    const currentLevel = this.getIndentationLevel(lines[currentIndex]);
    const nextLineLevel = this.getIndentationLevel(lines[currentIndex + 1]);

    return nextLineLevel > currentLevel;
  }

  private calculateRange(lines: string[], startIndex: number, level: number): { start: number, end: number } {
    const start = startIndex;
    let end = startIndex;

    // Include all lines that are children (higher level) of this line
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue; // Skip empty lines

      const lineLevel = this.getIndentationLevel(line);

      // If this line is at same or lower level than current, we've reached the end
      if (lineLevel <= level) {
        break;
      }

      // This line is deeper than our level, so it belongs to our block
      end = i;
    }
    return { start, end };
  }
}