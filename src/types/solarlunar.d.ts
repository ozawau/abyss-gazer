declare module "solarlunar" {
  export interface SolarLunarResult {
    lYear: number;
    lMonth: number;
    lDay: number;
    animal: string;
    yearCn: string;
    monthCn: string;
    dayCn: string;
    cYear: number;
    cMonth: number;
    cDay: number;
    gzYear: string;
    gzMonth: string;
    gzDay: string;
    isToday: boolean;
    isLeap: boolean;
    nWeek: number;
    ncWeek: string;
    isTerm: boolean;
    term: string;
  }

  const solarLunar: {
    solar2lunar(
      year?: number,
      month?: number,
      day?: number,
    ): SolarLunarResult | -1;
  };

  export default solarLunar;
}
