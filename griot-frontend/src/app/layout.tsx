import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ErrorBoundary } from "@/components/error/ErrorBoundary";
import { NotificationContainer } from "@/components/notifications/NotificationContainer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Griot - AI-Powered Manga Creation Platform",
  description:
    "Transform your imagination into stunning manga stories with AI. Create personalized manga content tailored to your preferences.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ErrorBoundary>
          <NotificationProvider>
            <AuthProvider>{children}</AuthProvider>
            <NotificationContainer />
          </NotificationProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
