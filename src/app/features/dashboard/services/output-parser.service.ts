import { Injectable } from '@angular/core';
import { KubeResource, PodDescribeData, ParsedOutput, TableData, YamlItem } from '../../../shared/models/kubectl.models';

export type { KubeResource, PodDescribeData, ParsedOutput, TableData, YamlItem };

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

    // Check for multiple pod describe output
    if (this.hasEventsTableInOutput(trimmedOutput) && this.isMultiplePodDescribe(trimmedOutput)) {
      const podData = this.parseMultiplePodDescribe(trimmedOutput);
      return {
        type: 'multiple-pods',
        podData
      };
    }

    // Check for single pod describe with events - use "yaml"
    // if (this.hasEventsTableInOutput(trimmedOutput)) {
    //   const { beforeEvents, headers, events } = this.parseEventsFromDescribe(trimmedOutput);
    //   return {
    //     type: 'events',
    //     rawOutput: beforeEvents,
    //     headers,
    //     data: events,
    //     hasEventsTable: true
    //   };
    // }

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

  private hasEventsTableInOutput(output: string): boolean {
    return output.includes('Events:') &&
      output.includes('Type') &&
      output.includes('Reason') &&
      output.includes('Age') &&
      output.includes('Message');
  }

  private isMultiplePodDescribe(output: string): boolean {
    const nameMatches = output.match(/^Name:\s+/gm);
    return nameMatches !== null && nameMatches.length > 1;
  }

  private parseEventsFromDescribe(output: string): { beforeEvents: string, headers: string[], events: KubeResource[] } {
    const lines = output.split('\n');

    // Find the LAST Events section (in case of multiple pods)
    let lastEventsStartIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === 'Events:') {
        lastEventsStartIndex = i;
        break;
      }
    }

    if (lastEventsStartIndex === -1) {
      return { beforeEvents: output, headers: [], events: [] };
    }

    // Set the full output (before the LAST Events section) as text
    const beforeEvents = lines.slice(0, lastEventsStartIndex).join('\n').trim();

    // Find the header line after the last Events section
    let headerIndex = -1;
    for (let i = lastEventsStartIndex + 1; i < lines.length; i++) {
      if (lines[i].includes('Type') && lines[i].includes('Reason') && lines[i].includes('Age')) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) {
      return { beforeEvents: output, headers: [], events: [] };
    }

    // Skip the separator line (----)
    let dataStartIndex = headerIndex + 2;
    if (dataStartIndex >= lines.length) {
      return { beforeEvents: output, headers: [], events: [] };
    }

    // Extract headers and data from the last Events section only
    const headers = lines[headerIndex].split(/\s{2,}/).filter(h => h.trim());

    // Get all event lines from the last Events section until end of output or next pod
    const eventLines = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i];
      // Stop if we hit another pod description or empty lines at end
      if (line.trim() === '' || line.startsWith('Name:')) {
        break;
      }
      if (line.trim()) {
        eventLines.push(line);
      }
    }

    const events: KubeResource[] = eventLines.map(line => {
      const parts = line.trim().split(/\s+/);
      const resource: KubeResource = {};

      // Events table has: Type, Reason, Age, From, Message
      // Message can contain spaces, so we need special handling
      if (parts.length >= 5) {
        resource['type'] = parts[0] || '';
        resource['reason'] = parts[1] || '';
        resource['age'] = parts[2] || '';
        resource['from'] = parts[3] || '';
        resource['message'] = parts.slice(4).join(' ') || '';
      } else {
        headers.forEach((header, index) => {
          resource[header.toLowerCase()] = parts[index] || '';
        });
      }

      return resource;
    });

    return { beforeEvents, headers, events };
  }

  private parseMultiplePodDescribe(output: string): PodDescribeData[] {
    const lines = output.split('\n');
    const podData: PodDescribeData[] = [];

    // Find all Name: lines to identify pod boundaries
    const podStartIndices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('Name:')) {
        podStartIndices.push(i);
      }
    }

    // Process each pod
    for (let podIndex = 0; podIndex < podStartIndices.length; podIndex++) {
      const startIndex = podStartIndices[podIndex];
      const endIndex = podIndex < podStartIndices.length - 1 ? podStartIndices[podIndex + 1] : lines.length;
      const podLines = lines.slice(startIndex, endIndex);

      // Extract pod name
      const podName = podLines[0].replace('Name:', '').trim();

      // Find Events section for this pod
      let eventsStartIndex = -1;
      for (let i = 0; i < podLines.length; i++) {
        if (podLines[i].trim() === 'Events:') {
          eventsStartIndex = i;
          break;
        }
      }

      let podDetails = '';
      let events: KubeResource[] = [];
      let headers: string[] = ['Type', 'Reason', 'Age', 'From', 'Message']; // Default headers

      if (eventsStartIndex !== -1) {
        // Split pod into details and events
        podDetails = podLines.slice(0, eventsStartIndex).join('\n').trim();

        // Parse events - look for header line
        let headerIndex = -1;
        for (let i = eventsStartIndex + 1; i < podLines.length; i++) {
          if (podLines[i].includes('Type') && podLines[i].includes('Reason') && podLines[i].includes('Age')) {
            headerIndex = i;
            break;
          }
        }

        if (headerIndex !== -1) {
          headers = podLines[headerIndex].split(/\s+/).filter((h: string) => h.trim());

          // Find data start (skip separator line ----)
          let dataStartIndex = headerIndex + 1;
          while (dataStartIndex < podLines.length && podLines[dataStartIndex].includes('----')) {
            dataStartIndex++;
          }

          // Collect all event lines from this pod
          for (let i = dataStartIndex; i < podLines.length; i++) {
            const line = podLines[i];
            if (!line.trim()) continue; // Skip empty lines

            const parts = line.trim().split(/\s+/);
            if (parts.length >= 4) { // Valid event line
              const resource: KubeResource = {};
              resource['type'] = parts[0] || '';
              resource['reason'] = parts[1] || '';
              resource['age'] = parts[2] || '';
              resource['from'] = parts[3] || '';
              resource['message'] = parts.slice(4).join(' ') || '';
              events.push(resource);
            }
          }
        }
      } else {
        // No events section, just details
        podDetails = podLines.join('\n').trim();
      }

      podData.push({
        name: podName,
        details: podDetails,
        events: events,
        headers: headers
      });
    }

    return podData;
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
      // 找到 items: 行
      const lines = output.split('\n');
      let itemsStartIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === 'items:') {
          itemsStartIndex = i;
          break;
        }
      }

      if (itemsStartIndex === -1) return yamls;

      // 解析每個 YAML 物件
      let currentYaml = '';
      let currentTitle = '';
      let inItem = false;

      for (let i = itemsStartIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        // 檢查是否是新的物件開始 (- apiVersion:)
        if (line.startsWith('- apiVersion:')) {
          // console.log(lines)
          // 保存前一個物件
          if (inItem && currentYaml && currentTitle) {
            yamls.push({
              title: currentTitle,
              yamlContent: currentYaml.trim()
            });
          }

          // 開始新物件
          currentYaml = line.substring(2) + '\n'; // 移除 "- " 前綴
          currentTitle = '';
          inItem = true;
        } else if (inItem) {
          currentYaml += line + '\n';

          // 提取物件名稱 (從 metadata.name)
          if (!currentTitle && line.includes('name:') && line.includes('  ')) {
            const nameMatch = line.match(/^\s+name:\s+(.+)$/);
            if (nameMatch) {
              currentTitle = nameMatch[1].trim();
            }
          }
        }
      }

      // 保存最後一個物件
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
    // 優先檢查命令類型 - 所有 describe 命令都當作 YAML 處理
    if (command.includes('describe') || command.includes('-o yaml')) {
      return true;
    }

    // 檢查典型的 kubectl describe 輸出特徵
    const lines = output.split('\n').filter(line => line.trim());
    if (lines.length < 3) return false;

    // kubectl describe 的典型特徵
    const hasNameAndNamespace = output.includes('Name:') && output.includes('Namespace:');
    const hasLabelsOrAnnotations = output.includes('Labels:') || output.includes('Annotations:');
    const hasIndentedStructure = lines.some(line => line.match(/^\s{2,}\w+:/));

    return hasNameAndNamespace && hasLabelsOrAnnotations && hasIndentedStructure;
  }
}