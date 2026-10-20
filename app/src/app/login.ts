import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent {
  protected username = '';
  protected password = '';
  protected displayName = localStorage.getItem('ausim.beta.displayName') ?? '';
  protected consent = localStorage.getItem('ausim.beta.consent') === 'yes';
  protected loading = false;
  protected error = '';

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.error = '';
    if (!this.displayName.trim()) {
      this.error = 'Enter your name before continuing.';
      return;
    }
    if (!this.consent) {
      this.error = 'You need to accept the beta data notice.';
      return;
    }
    this.loading = true;
    this.changeDetector.markForCheck();
    const result = await this.auth.login({
      username: this.username.trim(),
      password: this.password,
      displayName: this.displayName.trim(),
      consent: this.consent,
    });
    this.loading = false;
    if (!result.ok) {
      this.error = result.error;
      this.changeDetector.markForCheck();
      return;
    }
    localStorage.setItem('ausim.beta.displayName', this.displayName.trim());
    localStorage.setItem('ausim.beta.consent', 'yes');
    const user = this.auth.currentUser();
    await this.router.navigateByUrl(user?.isAdmin ? '/admin' : '/planner');
    this.changeDetector.markForCheck();
  }
}
