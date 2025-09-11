import { Injectable } from '@angular/core';

interface ExecutionContext {
  group?: string;
  uuid: string;
}

@Injectable({
  providedIn: 'root'
})
export class ExecutionContextService {
  private contextStack: ExecutionContext[] = [];

  /**
   * executing within the group
   */
  async withGroup<T>(group: string, fn: () => Promise<T>): Promise<T> {
    const context: ExecutionContext = {
      group,
      uuid: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    // register current context with group name and uuid
    this.contextStack.push(context);

    try {
      return await fn();
    } finally {
      // LIFO
      const popped = this.contextStack.pop();
      if (popped?.uuid !== context.uuid) {
        console.warn(`Context stack corruption detected. Expected ${context.uuid}, got ${popped?.uuid}`);
      }
    }
  }

  /**
   * get current group name
   */
  getCurrentGroup(): string | undefined {
    const currentContext = this.getCurrentContext();
    return currentContext?.group;
  }

  /**
   * get current context
   */
  getCurrentContext(): ExecutionContext | undefined {
    return this.contextStack[this.contextStack.length - 1];
  }


  /**
   * check if exist
   */
  isInGroup(group: string): boolean {
    return this.contextStack.some(ctx => ctx.group === group);
  }
}