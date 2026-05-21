import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n/index.js';

const HeirloomsPreviewCard = () => {
  const { isEnglish } = useI18n();
  const serifDisplayStyle = {
    fontFamily: '"Harmony Sans App", "Noto Serif SC", "Source Han Serif SC", serif',
  };

  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const targetDate = new Date('2026-05-22T19:30:00+08:00').getTime();
    
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const distance = targetDate - now;

      if (distance < 0) {
        clearInterval(timer);
        return;
      }

      setTimeLeft({
        days: Math.floor(distance / (1000 * 60 * 60 * 24)),
        hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((distance % (1000 * 60)) / 1000)
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const pad = (num) => String(num).padStart(2, '0');

  const topoPattern = `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7z' fill='%23ffffff' fill-opacity='0.03' fill-rule='evenodd'/%3E%3C/svg%3E")`;

  return (
    <div className="relative w-full min-h-[300px] overflow-hidden shadow-2xl rounded-sm group flex flex-col justify-between border border-white/10 bg-[#0d0d0d]">
      {/* Background Layers */}
      <div className="absolute inset-0 opacity-80 mix-blend-screen" style={{
          background: 'repeating-radial-gradient(circle at 50% 0%, transparent 0, transparent 8px, rgba(200, 16, 26, 0.15) 8px, rgba(200, 16, 26, 0.15) 9px)'
      }}></div>
      <div className="absolute inset-0 opacity-60 mix-blend-overlay" style={{ backgroundImage: topoPattern }}></div>
      
      {/* Red Bars Background */}
      <div className="absolute top-[35%] w-full h-[15%] flex flex-col justify-between opacity-80 z-0">
          <div className="h-1/3 bg-gradient-to-r from-transparent via-[#c8101a] to-transparent opacity-60"></div>
          <div className="h-1/3 bg-gradient-to-r from-transparent via-[#c8101a] to-transparent opacity-40"></div>
      </div>
      
      {/* Black Triangles */}
      <div className="absolute top-[40%] left-0 w-full flex justify-between px-10 z-0">
          <div className="w-[30%] aspect-square bg-[#111] opacity-90 border-b border-white/5" style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }}></div>
          <div className="w-[30%] aspect-square bg-[#111] opacity-90 border-b border-white/5" style={{ clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }}></div>
      </div>

      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/90 pointer-events-none z-0"></div>

      {/* Content */}
      <div className="relative z-10 w-full h-full flex flex-col items-center justify-start pt-6 pb-4 md:pt-8 md:pb-6">
          {/* Logos */}
          <div className="flex items-end gap-2 md:gap-3 mb-6 md:mb-8 scale-90 md:scale-100">
              <div className="flex flex-col items-end">
                  <span className="text-[10px] text-white font-bold tracking-[0.2em] leading-none mb-1">明日方舟</span>
                  <span className="text-3xl md:text-4xl font-black text-white leading-none tracking-tighter" style={{ fontFamily: 'Impact, sans-serif' }}>终末地</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-white text-black px-1 py-0.5 mb-1">
                  <span className="text-[5px] font-black font-mono leading-none">ARKNIGHTS</span>
                  <span className="text-[5px] font-black font-mono leading-none mt-px">ENDFIELD</span>
              </div>
              <div className="flex flex-col items-start pb-0.5 ml-1 md:ml-2 border-l border-white/30 pl-3 md:pl-4">
                  <span className="text-2xl md:text-3xl font-black text-white leading-none tracking-[0.1em]" style={serifDisplayStyle}>
                      {isEnglish ? 'LOST HEIRLOOMS' : '寻遗散记'}
                  </span>
                  <span className="text-[6px] md:text-[7px] text-white tracking-[0.3em] leading-none mt-1 md:mt-1.5 opacity-80">SKETCHES OF LOST HEIRLOOMS</span>
              </div>
          </div>

          {/* Title */}
          <div className="flex items-center gap-3 md:gap-4 mt-auto mb-2 drop-shadow-2xl">
              <div className="grid grid-cols-2 gap-1 md:gap-1.5 opacity-80">
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#cca86e]"></div>
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#cca86e]"></div>
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#cca86e]"></div>
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#cca86e]"></div>
              </div>
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white tracking-[0.15em] px-2 drop-shadow-lg" style={serifDisplayStyle}>
                  {isEnglish ? 'VERSION PREVIEW' : '版本前瞻预告'}
              </h1>
              <div className="grid grid-cols-2 gap-1 md:gap-1.5 opacity-80">
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#cca86e]"></div>
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#cca86e]"></div>
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#cca86e]"></div>
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#cca86e]"></div>
              </div>
          </div>

          {/* Sub banner */}
          <div className="bg-[#c8101a] text-white flex items-center px-3 md:px-4 py-0.5 text-[6px] md:text-[8px] font-mono tracking-widest shadow-lg mb-auto">
              <span className="font-bold opacity-90">TALOS-II</span>
              <span className="mx-2 opacity-50">|</span>
              <span className="opacity-80">ENDFIELD INDUSTRIES</span>
              <span className="ml-2 border border-white/30 px-1 opacity-70 text-[5px] md:text-[6px] hidden sm:block">MOVE THE FRONTIER INTO THE FUTURE</span>
          </div>

          {/* Bottom Info & Countdown */}
          <div className="flex flex-col items-center justify-end w-full mt-6 md:mt-auto relative scale-90 sm:scale-100">
              <div className="flex flex-col items-center bg-black/40 px-6 md:px-8 py-3 md:py-4 backdrop-blur-md border border-white/10 shadow-2xl relative overflow-hidden">
                  <div className="absolute inset-0 opacity-10" style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.2) 10px, rgba(0,0,0,0.2) 20px)' }}></div>
                  
                  <div className="text-[8px] md:text-[10px] text-[#c8101a] font-bold mb-1 tracking-[0.3em] uppercase z-10">
                      LIVE COUNTDOWN
                  </div>
                  
                  <div className="flex items-baseline gap-2 md:gap-3 text-white font-bold z-10" style={serifDisplayStyle}>
                      <div className="flex items-baseline text-4xl md:text-5xl text-[#cca86e] drop-shadow-md">
                          {pad(timeLeft.days)}
                          <span className="text-xs md:text-sm text-white/50 ml-1 font-sans tracking-widest">{isEnglish ? 'D' : '天'}</span>
                      </div>
                      <span className="text-2xl md:text-3xl text-white/30 mb-1 md:mb-2">:</span>
                      <div className="flex items-baseline text-3xl md:text-4xl">
                          {pad(timeLeft.hours)}
                          <span className="text-xs md:text-sm text-white/50 ml-1 font-sans tracking-widest">{isEnglish ? 'H' : '时'}</span>
                      </div>
                      <span className="text-2xl md:text-3xl text-white/30 mb-1 md:mb-2">:</span>
                      <div className="flex items-baseline text-3xl md:text-4xl">
                          {pad(timeLeft.minutes)}
                          <span className="text-xs md:text-sm text-white/50 ml-1 font-sans tracking-widest">{isEnglish ? 'M' : '分'}</span>
                      </div>
                      <span className="text-2xl md:text-3xl text-white/30 mb-1 md:mb-2">:</span>
                      <div className="flex items-baseline text-3xl md:text-4xl opacity-80">
                          {pad(timeLeft.seconds)}
                          <span className="text-xs md:text-sm text-white/50 ml-1 font-sans tracking-widest">{isEnglish ? 'S' : '秒'}</span>
                      </div>
                  </div>
              </div>
          </div>

          <div className="absolute bottom-2 md:bottom-4 text-[6px] md:text-[8px] text-white/40 tracking-widest font-mono z-10">
              © HYPERGRYPH
          </div>
      </div>

      {/* Hover Action */}
      <a href="https://live.bilibili.com/1921300321" target="_blank" rel="noreferrer" className="absolute inset-0 z-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/70 backdrop-blur-sm">
          <div className="px-8 md:px-10 py-3 md:py-4 bg-[#8a0b12] border border-[#c8101a] text-white font-bold font-mono tracking-widest text-lg md:text-xl hover:bg-[#c8101a] hover:scale-105 transition-all shadow-[0_0_40px_rgba(200,16,26,0.6)] flex items-center gap-3">
              <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              {isEnglish ? 'WATCH LIVE' : '前往直播间'}
          </div>
      </a>
    </div>
  );
};

export default HeirloomsPreviewCard;
