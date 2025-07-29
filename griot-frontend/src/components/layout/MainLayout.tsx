"use client";

import { ReactNode } from "react";
import Navigation from "./Navigation";

interface MainLayoutProps {
  children: ReactNode;
  showNavigation?: boolean;
}

export default function MainLayout({
  children,
  showNavigation = true,
}: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {showNavigation && <Navigation />}
      <main className={showNavigation ? "pt-0" : ""}>{children}</main>
    </div>
  );
}
