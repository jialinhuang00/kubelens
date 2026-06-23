import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class RolloutService {
  generateSetImageCommand(deployment: string, container: string, namespace: string, image: string): string {
    return `kubectl set image deployment/${deployment} ${container}=${image} -n ${namespace}`;
  }

}