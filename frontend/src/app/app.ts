import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTypographyModule } from 'ng-zorro-antd/typography';
import { NzUploadChangeParam, NzUploadModule } from 'ng-zorro-antd/upload';

@Component({
  selector: 'app-root',
  imports: [
    FormsModule, NzAlertModule, NzButtonModule, NzCardModule, NzIconModule,
    NzInputModule, NzRadioModule, NzTabsModule, NzTypographyModule, NzUploadModule,
  ],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly url = signal('');
  protected readonly error = signal('');
  protected readonly hint = signal('');
  protected readonly loading = signal(false);

  protected ytUrl = '';
  protected ytFormat: 'mp4' | 'mp3' = 'mp4';

  ngOnInit() {
    this.http.get<{ maxMb: number; extensions: string[] }>('/config').subscribe((c) =>
      this.hint.set(`Max ${c.maxMb} MB · ${c.extensions.map((e) => e.slice(1)).join(', ')}`),
    );
  }

  protected onChange({ file }: NzUploadChangeParam) {
    if (file.status === 'uploading') {
      this.url.set('');
      this.error.set('');
    } else if (file.status === 'done') {
      this.url.set(file.response.url);
    } else if (file.status === 'error') {
      this.error.set(file.error?.error?.error ?? 'Upload failed');
    }
  }

  protected convert() {
    this.url.set('');
    this.error.set('');
    this.loading.set(true);
    this.http.post<{ url: string }>('/youtube', { url: this.ytUrl, format: this.ytFormat }).subscribe({
      next: (r) => { this.url.set(r.url); this.loading.set(false); },
      error: (e) => { this.error.set(e.error?.error ?? 'Request failed'); this.loading.set(false); },
    });
  }
}
