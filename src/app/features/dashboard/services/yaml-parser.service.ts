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

    const hasColon = trimmedLine.includes(':');
    const isLikelyContinuation = !hasColon && spaces > 0;
    const isArrayItem = trimmedLine.startsWith('- ');

    let level = 0;
    if (isArrayItem) {
      level = spaces + 0.5;
    } else if (isLikelyContinuation) {
      level = Math.min(spaces, 10);
    } else {
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

    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const lineLevel = this.getIndentationLevel(line);

      if (lineLevel <= level) {
        break;
      }

      end = i;
    }
    return { start, end };
  }
}
