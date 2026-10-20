import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { Router } from '@angular/router';
import { BetaDataService, BattleSummary } from './services/beta-data.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-admin',
  imports: [CommonModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class AdminComponent {
  protected loading = true;
  protected error = '';
  protected battles: BattleSummary[] = [];

  constructor(
    private readonly betaData: BetaDataService,
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const result = await this.betaData.listBattles();
      this.loading = false;
      if (result.result === 'failed') {
        this.error = result.error;
        this.battles = [];
        this.changeDetector.markForCheck();
        return;
      }
      this.battles = result.battles;
      this.changeDetector.markForCheck();
    } catch {
      this.loading = false;
      this.error = 'Unable to load battle list.';
      this.battles = [];
      this.changeDetector.markForCheck();
    }
  }

  protected turnLink(id: string): string {
    return this.betaData.turnDownloadUrl(id);
  }

  protected sheetLink(id: string): string {
    return this.betaData.sheetDownloadUrl(id);
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  protected async openPlanner(): Promise<void> {
    await this.router.navigateByUrl('/planner');
  }
}
