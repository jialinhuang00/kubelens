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

    // kubectl describe 格式檢測：
    // 如果一行只有值沒有key（沒有冒號），這通常是多行值的延續
    const hasColon = trimmedLine.includes(':');
    const isLikelyContinuation = !hasColon && spaces > 0;
    const isArrayItem = trimmedLine.startsWith('- ');

    let level = 0;
    if (isArrayItem) {
      // Array item 應該比同樣縮排的 parent 更深一層
      // 例如：clusterIPs: (2 spaces) 和 - 10.96.96.125 (2 spaces) 
      // - 10.96.96.125 應該是 level 2.5，這樣它會被視為 clusterIPs: 的子項
      level = spaces + 0.5;
    } else if (isLikelyContinuation) {
      // 延續行設為適度的子層級，避免過深
      level = Math.min(spaces, 10); // 限制最大層級為 10
    } else {
      // 直接用空格數作為層級
      level = spaces;
    }

    // Debug: 顯示每行的空格數和計算出的層級
    // console.log(`"${line}" -> ${spaces} spaces, hasColon: ${hasColon}, continuation: ${isLikelyContinuation}, arrayItem: ${isArrayItem} -> level ${level}`);

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

    // Debug logging
    const currentLine = lines[startIndex];
    // console.log(`Calculating range for line ${startIndex}: "${currentLine.trim()}" at level ${level}`);

    // Include all lines that are children (higher level) of this line
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue; // Skip empty lines

      const lineLevel = this.getIndentationLevel(line);
      // console.log(`  Line ${i}: "${line.trim()}" at level ${lineLevel}`);

      // If this line is at same or lower level than current, we've reached the end
      if (lineLevel <= level) {
        // console.log(`  Stopping at line ${i} because ${lineLevel} <= ${level}`);
        break;
      }

      // This line is deeper than our level, so it belongs to our block
      end = i;
      // console.log(`  Including line ${i} in range`);
    }

    // console.log(`Final range: ${start} to ${end}`);
    return { start, end };
  }
}