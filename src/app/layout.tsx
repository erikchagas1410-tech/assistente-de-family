import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Personal Finance QG",
  description: "Dashboard Financeiro em Dark Mode",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className={`${inter.className} text-slate-50 bg-[#05050a] min-h-screen relative`}>
        {/* Fundo Cyberpunk (High Tech, Low Life) */}
        <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
          {/* Grid Holográfico Neon */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#00f0ff08_1px,transparent_1px),linear-gradient(to_bottom,#00f0ff08_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
          {/* Orbs de Poluição Luminosa */}
          <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-cyan-600/15 blur-[120px] animate-blob"></div>
          <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-fuchsia-600/15 blur-[150px] animate-blob" style={{ animationDelay: '2s' }}></div>
          <div className="absolute bottom-[-20%] left-[20%] w-[700px] h-[700px] rounded-full bg-yellow-600/10 blur-[130px] animate-blob" style={{ animationDelay: '4s' }}></div>
        </div>
        
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}