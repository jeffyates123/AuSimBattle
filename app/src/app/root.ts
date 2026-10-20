import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root-shell',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class RootComponent {}
