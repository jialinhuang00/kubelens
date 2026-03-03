import { Injectable } from '@angular/core';
import { KubeResource, ParsedOutput, TableData, YamlItem } from '../../../shared/models/kubectl.models';

@Injectable({
  providedIn: 'root'
})
export class OutputParserService {

  parseCommandOutput(output: string, command: string = ''): ParsedOutput {
    const trimmedOutput = output.trim();

    // Check for multiple tables (kubectl get all --all-namespaces)
    if (this.hasMultipleTables(trimmedOutput)) {
      const tables = this.parseMultipleTables(trimmedOutput);
      return {
        type: 'multiple-tables',
        tables
      };
    }

    // Check for multiple YAML objects (kubectl get svc -o yaml)
    if (this.hasMultipleYamls(trimmedOutput)) {
      const yamls = this.parseMultipleYamls(trimmedOutput);
      return {
        type: 'multiple-yamls',
        yamls
      };
    }

    // Try to parse as tabular output first
    if (this.isTabularOutput(trimmedOutput, command)) {
      const { headers, data } = this.parseTabularOutput(trimmedOutput, command);
      return {
        type: 'table',
        headers,
        data
      };
    }

    // Check if output is YAML-like (describe commands)
    if (this.isYamlLikeOutput(trimmedOutput, command)) {
      return {
        type: 'yaml',
        yamlContent: trimmedOutput
      };
    }

    // Default to raw output
    return {
      type: 'raw',
      rawOutput: trimmedOutput
    };
  }

  private isTabularOutput(output: string, command: string = ''): boolean {
    const lines = output.split('\n').filter(line => line.trim());

    // Skip if too few lines
    if (lines.length < 2) return false;

    // Skip JSON
    if (output.trim().startsWith('{') || output.trim().startsWith('[')) return false;

    // Skip describe commands (YAML-like structure with colons)
    if (command.includes('describe')) return false;

    // Skip logs commands (plain text output)
    if (command.includes('logs')) return false;

    // Skip YAML
    if (output.includes('apiVersion:') || output.includes('kind:') ||
      output.includes('metadata:') || output.includes('spec:')) return false;

    // Skip YAML2: describe output format (Name:, Namespace:, Labels: pattern)
    if (output.includes('Name:') && output.includes('Namespace:') &&
      (output.includes('Labels:') || output.includes('Annotations:'))) return false;

    // Skip config view output
    if (output.includes('apiVersion: v1') || output.includes('clusters:') ||
      output.includes('contexts:') || output.includes('users:')) return false;

    // Skip other structured outputs
    if (output.includes('---') || lines[0].startsWith('  ')) return false;

    // Check if it looks like a table (header + consistent columns)
    const headerLine = lines[0];
    const headers = headerLine.split(/\s{2,}/);

    // Must have multiple columns
    if (headers.length < 2) return false;

    // Check if subsequent lines have similar column structure
    let tableRowCount = 0;
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
      const columns = lines[i].split(/\s{2,}/);
      if (columns.length >= headers.length - 1) {
        tableRowCount++;
      }
    }

    // If most lines look like table rows, it's probably a table
    return tableRowCount >= Math.min(2, lines.length - 1);
  }

  private parseTabularOutput(output: string, command: string = ''): { headers: string[], data: KubeResource[] } {
    const lines = output.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      return { headers: [], data: [] };
    }

    // Check if command has --no-headers
    const hasNoHeaders = command.includes('--no-headers');

    let headers: string[];
    let dataLines: string[];

    if (hasNoHeaders) {
      // For --no-headers commands, extract headers from custom-columns
      if (command.includes('custom-columns=')) {
        const customColsMatch = command.match(/custom-columns=["']([^"']+)["']/);
        if (customColsMatch) {
          const customCols = customColsMatch[1];
          headers = customCols.split(',').map(col => {
            const colonIndex = col.indexOf(':');
            return colonIndex > 0 ? col.substring(0, colonIndex).trim() : col.trim();
          });
        } else {
          // Fallback: guess headers from first line structure
          headers = ['COL1', 'COL2', 'COL3', 'COL4', 'COL5'].slice(0, lines[0].split(/\s{2,}/).length);
        }
      } else {
        // Standard kubectl get without custom-columns
        headers = ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE']; // Default for pods
      }
      dataLines = lines;
    } else {
      // Normal table with headers
      if (lines.length < 2) {
        return { headers: [], data: [] };
      }
      headers = lines[0].split(/\s{2,}/);
      dataLines = lines.slice(1);
    }

    const data: KubeResource[] = dataLines.map(line => {
      const values = line.split(/\s{2,}/);
      const resource: KubeResource = {};
      headers.forEach((header, index) => {
        resource[header.toLowerCase()] = values[index] || '';
      });
      return resource;
    });

    return { headers, data };
  }

  private hasMultipleTables(output: string): boolean {
    // Check if output contains multiple "=== ResourceType ===" sections
    const tableSectionCount = (output.match(/=== \w+ ===/g) || []).length;
    return tableSectionCount > 1;
  }

  private parseMultipleTables(output: string): TableData[] {
    const tables: TableData[] = [];
    const sections = output.split(/(?=^=== \w+ ===)/m).filter(section => section.trim());

    for (const section of sections) {
      const lines = section.split('\n').filter(line => line.trim());
      if (lines.length < 2) continue;

      // Extract title from "=== ResourceType ===" line
      const titleMatch = lines[0].match(/=== (\w+) ===/);
      if (!titleMatch) continue;

      const title = titleMatch[1];

      // Find the header line (look for typical kubectl headers)
      let headerIndex = -1;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('NAME') && (
          line.includes('READY') ||
          line.includes('TYPE') ||
          line.includes('CLUSTER-IP') ||
          line.includes('DESIRED') ||
          line.includes('CURRENT') ||
          line.includes('AVAILABLE'))) {
          headerIndex = i;
          break;
        }
      }

      if (headerIndex === -1 || headerIndex >= lines.length - 1) continue;

      // Parse headers and data - use 2+ spaces for better column separation
      const headers = lines[headerIndex].split(/\s{2,}/).filter(h => h.trim());
      const dataLines = lines.slice(headerIndex + 1);

      const data: KubeResource[] = dataLines.map(line => {
        const values = line.split(/\s{2,}/);
        const resource: KubeResource = {};
        headers.forEach((header, index) => {
          resource[header.toLowerCase()] = values[index] || '';
        });
        return resource;
      });

      tables.push({
        title,
        headers,
        data
      });
    }

    return tables;
  }

  private hasMultipleYamls(output: string): boolean {
    // apiVersion: v1
    // kind: List
    // items:
    // - apiVersion: v1
    const hasApiVersion = output.includes('apiVersion:');
    const hasKindList = output.includes('kind: List');
    const hasItems = output.includes('items:');
    const hasItemsArray = output.includes('- apiVersion:');

    return hasApiVersion && hasKindList && hasItems && hasItemsArray;
  }

  private parseMultipleYamls(output: string): YamlItem[] {
    const yamls: YamlItem[] = [];

    try {
      // Find the items: line
      const lines = output.split('\n');
      let itemsStartIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === 'items:') {
          itemsStartIndex = i;
          break;
        }
      }

      if (itemsStartIndex === -1) return yamls;

      // Parse each YAML object
      let currentYaml = '';
      let currentTitle = '';
      let inItem = false;

      for (let i = itemsStartIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        // Check if this is the start of a new object (- apiVersion:)
        if (line.startsWith('- apiVersion:')) {
          // Save previous object
          if (inItem && currentYaml && currentTitle) {
            yamls.push({
              title: currentTitle,
              yamlContent: currentYaml.trim()
            });
          }

          // Start new object
          currentYaml = line.substring(2) + '\n'; // strip "- " prefix
          currentTitle = '';
          inItem = true;
        } else if (inItem) {
          currentYaml += line + '\n';

          // Extract object name (from metadata.name)
          if (!currentTitle && line.includes('name:') && line.includes('  ')) {
            const nameMatch = line.match(/^\s+name:\s+(.+)$/);
            if (nameMatch) {
              currentTitle = nameMatch[1].trim();
            }
          }
        }
      }

      // Save last object
      if (inItem && currentYaml && currentTitle) {
        yamls.push({
          title: currentTitle,
          yamlContent: currentYaml.trim()
        });
      }

    } catch (error) {
      console.error('Error parsing multiple YAMLs:', error);
    }

    return yamls;
  }

  private isYamlLikeOutput(output: string, command: string = ''): boolean {
    // Check command type first — all describe commands are treated as YAML
    if (command.includes('describe') || command.includes('-o yaml')) {
      return true;
    }

    // Check for typical kubectl describe output patterns
    const lines = output.split('\n').filter(line => line.trim());
    if (lines.length < 3) return false;

    // Typical kubectl describe markers
    const hasNameAndNamespace = output.includes('Name:') && output.includes('Namespace:');
    const hasLabelsOrAnnotations = output.includes('Labels:') || output.includes('Annotations:');
    const hasIndentedStructure = lines.some(line => line.match(/^\s{2,}\w+:/));

    return hasNameAndNamespace && hasLabelsOrAnnotations && hasIndentedStructure;
  }
}