'use client';

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import '@/styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:          60_000,   // 1 minute
      retry:              1,
      refetchOnWindowFocus: false,
    },
  },
});

export const metadata = {
  title:       'Wodoga Platform',
  description: 'Home Health & Pharmaceutical Operations Platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 3500,
              style: {
                fontFamily: 'Manrope, sans-serif',
                fontSize:   '13px',
                fontWeight: '500',
                borderRadius: '10px',
                border: '1px solid #E4E1DA',
                boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
                padding: '12px 16px',
                color: '#1A1917',
              },
              success: { iconTheme: { primary: '#40916C', secondary: '#fff' } },
              error:   { iconTheme: { primary: '#DC2626', secondary: '#fff' } },
            }}
          />
        </QueryClientProvider>
      </body>
    </html>
  );
}
