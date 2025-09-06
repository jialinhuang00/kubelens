import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { YamlParserService, YamlLine } from '../../services/yaml-parser.service';

@Component({
  selector: 'app-yaml-display',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="yaml-container">
      <div class="yaml-content-container">
        @for (line of yamlLines(); track line.lineNumber; let i = $index) {
          <div 
            class="yaml-line"
            [class]="'level-' + line.level + (line.isExpandable ? ' expandable' : '') + (isLineHighlighted(line.lineNumber) ? ' yaml-highlighted' : '') + (isFirstHighlightedLine(line.lineNumber) ? ' yaml-highlighted-first' : '') + (isLastHighlightedLine(line.lineNumber) ? ' yaml-highlighted-last' : '')"
            [attr.data-range-start]="line.rangeStart"
            [attr.data-range-end]="line.rangeEnd"
            [attr.data-level]="line.level"
            [style.background-color]="getLineBackgroundColor(line.lineNumber)"
            [style.--yaml-border-color]="getLineBorderColor(line.lineNumber)"
            [style.--text-start-offset]="getTextStartOffset(line.lineNumber)"
            (mouseenter)="onLineHover(line)"
            (mouseleave)="onLineLeave()">
            <span class="yaml-content">{{ line.content }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styleUrls: ['./yaml-display.component.scss']
})
export class YamlDisplayComponent {
  @Input() yamlText: string = '';

  yamlLines = signal<YamlLine[]>([]);
  hoveredRange = signal<{ start: number, end: number, level: number } | null>(null);

  private levelColors = [
    'rgba(255, 59, 48, 0.08)',   // Red - Level 0 (更淡)
    'rgba(0, 122, 255, 0.08)',   // Blue - Level 1  (更淡)
    'rgba(52, 199, 89, 0.08)',   // Green - Level 2 (更淡)
    'rgba(175, 82, 222, 0.08)',  // Purple - Level 3 (更淡)
    'rgba(255, 149, 0, 0.08)',   // Orange - Level 4 (更淡)
    'rgba(255, 204, 0, 0.08)',   // Yellow - Level 5 (更淡)
  ];

  private levelBorderColors = [
    '2px solid rgba(255, 59, 48, 0.6)',   // Red
    '2px solid rgba(0, 122, 255, 0.6)',   // Blue
    '2px solid rgba(52, 199, 89, 0.6)',   // Green  
    '2px solid rgba(175, 82, 222, 0.6)',  // Purple
    '2px solid rgba(255, 149, 0, 0.6)',   // Orange
    '2px solid rgba(255, 204, 0, 0.6)',   // Yellow
  ];

  constructor(private yamlParser: YamlParserService) { }

  ngOnInit() {
    this.parseYaml();
  }

  ngOnChanges() {
    this.parseYaml();
  }

  private parseYaml() {
    if (this.yamlText) {
      const lines = this.yamlParser.parseYamlToLines(this.yamlText);
      this.yamlLines.set(lines);
    }
  }

  onLineHover(line: YamlLine) {
    this.hoveredRange.set({
      start: line.rangeStart,
      end: line.rangeEnd,
      level: line.level
    });
  }

  onLineLeave() {
    this.hoveredRange.set(null);
  }

  getLineBackgroundColor(lineNumber: number): string {
    const range = this.hoveredRange();
    if (!range) return 'transparent';


    if (lineNumber >= range.start && lineNumber <= range.end) {
      const colorIndex = Math.min(range.level, this.levelColors.length - 1);
      return this.levelColors[colorIndex];
    }

    return 'transparent';
  }

  getLineBorderColor(lineNumber: number): string {
    const range = this.hoveredRange();
    if (!range) return '';
    // if hover only one line, no line.
    if (range.start === range.end) return 'transparent';

    if (lineNumber >= range.start && lineNumber <= range.end) {
      const colorIndex = Math.min(range.level, this.levelBorderColors.length - 1);
      const borderColor = this.levelBorderColors[colorIndex].match(/rgba?\([^)]+\)/)?.[0] || 'rgba(255, 59, 48, 0.6)';
      return borderColor;
    }

    return '';
  }

  getTextStartOffset(lineNumber: number): string {
    const range = this.hoveredRange();
    if (!range || lineNumber < range.start || lineNumber > range.end) {
      return '4px'; // Default padding
    }

    // Find the minimum indentation in the highlighted range
    const rangeLines = this.yamlLines().filter(l => l.lineNumber >= range.start && l.lineNumber <= range.end);
    const minSpaces = Math.min(...rangeLines.map(l => l.content.match(/^(\s*)/)?.[1]?.length || 0));

    // Calculate offset: yaml-line padding (4px) + character width (7px per space)
    const offset = 4 + (minSpaces * 7);
    return `${offset - 8}px`;
  }

  isLineHighlighted(lineNumber: number): boolean {
    const range = this.hoveredRange();
    if (!range) return false;

    return lineNumber >= range.start && lineNumber <= range.end;
  }

  isFirstHighlightedLine(lineNumber: number): boolean {
    const range = this.hoveredRange();
    if (!range) return false;

    return lineNumber === range.start;
  }

  isLastHighlightedLine(lineNumber: number): boolean {
    const range = this.hoveredRange();
    if (!range) return false;

    return lineNumber === range.end;
  }
}