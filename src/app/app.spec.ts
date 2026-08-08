import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

/**
 * This file was the Angular CLI template until 2026-08-08, unchanged since the
 * project's second commit. It asserted an `<h1>` containing "Hello, kubelens"
 * that this app has never had, and it configured no HttpClient, so `App` died
 * on `DataModeService`'s `inject(HttpClient)`. `pnpm test` was two failures for
 * five months, which means nobody could use it to notice a third.
 */
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),        // App renders a <router-outlet>
        provideHttpClient(),
        provideHttpClientTesting(), // App's ngOnInit pings for snapshot availability
      ],
    }).compileComponents();
  });

  afterEach(() => {
    // The availability ping is fire-and-forget; drain it so it cannot leak.
    TestBed.inject(HttpTestingController).match(() => true).forEach(r => r.flush({}));
  });

  it('creates', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the shell: top nav and a router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.app-shell')).toBeTruthy();
    expect(el.querySelector('app-top-nav')).toBeTruthy();
    expect(el.querySelector('router-outlet')).toBeTruthy();
  });

  it('asks whether a snapshot is available on init', () => {
    // The one thing App itself does. It was untested, and a broken spec file
    // meant nothing would have reported it.
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    expect(http.match(req => req.url.includes('/api/'))!.length).toBeGreaterThan(0);
  });
});
