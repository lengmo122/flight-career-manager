using SkylineVA.Msfs2024Telemetry;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

var engine = new P42LandingRateEngine(50, TimeSpan.FromMilliseconds(500));
var startedAt = new DateTimeOffset(2026, 8, 22, 13, 40, 0, TimeSpan.Zero);

Check(engine.Update(new LandingRateSample(startedAt, true, 0, 0, 1.0)) is null, "Ground initialization must not create a landing");
Check(engine.Update(new LandingRateSample(startedAt.AddSeconds(1), false, 120, 0, 1.0)) is null, "The approach must only arm the detector");
Check(engine.Update(new LandingRateSample(startedAt.AddSeconds(2), false, 20, 0, 1.0)) is null, "Descending through the gate must not create a landing");

var touchdownAt = startedAt.AddSeconds(3);
Check(engine.Update(new LandingRateSample(touchdownAt, true, 3, 108.8, 1.05)) is null, "The detector must wait for the peak-G window");
var result = engine.Update(new LandingRateSample(touchdownAt.AddMilliseconds(600), true, 3, 108.8, 1.13));

Check(result is not null, "A valid touchdown must emit a result");
Check(result!.Timestamp == touchdownAt, "The result must preserve the touchdown timestamp");
Check(result.LandingRateFpm == 108, "The landing rate must come from the touchdown sample");
Check(Math.Abs(result.PeakGForce - 1.13) < 0.001, "The peak G value must cover the post-touchdown window");
Check(result.BounceCount == 0, "A single touchdown must not be marked as a bounce");

// Fenix Airbus can expose touchdown normal velocity as zero on the exact
// ground-contact frame. The source detector must still accept the landing
// using the vertical-speed fallback supplied by P42LandingDetector.
static TelemetrySample Sample(DateTimeOffset timestamp, bool onGround, double radioAltitudeFt,
    double verticalSpeedFpm, double touchdownNormalVelocityFpm = 0) => new(
    timestamp, "FenixA319 CFM SL HD", "A319", "G-SMOL",
    31.15, 121.80, 90, 30, radioAltitudeFt, 0,
    onGround ? 0 : 140, onGround ? 0 : 140, verticalSpeedFpm, 0, 0,
    touchdownNormalVelocityFpm, onGround, false, 1.1, 0, 0, 5000, 20000,
    1, false, "ZSPD", -1, 0, -1);

var delayedRateDetector = new P42LandingDetector(new RunwayResolver(""));
Check(delayedRateDetector.Observe(Sample(startedAt, true, 0, 0)) is null,
    "Delayed-rate detector must ignore ground initialization");
Check(delayedRateDetector.Observe(Sample(startedAt.AddSeconds(1), false, 120, 0)) is null,
    "Delayed-rate detector must arm on approach");
Check(delayedRateDetector.Observe(Sample(startedAt.AddSeconds(2), false, 120, -300)) is null,
    "Delayed-rate detector must capture the approach gate");
Check(delayedRateDetector.Observe(Sample(startedAt.AddSeconds(2.5), false, 20, -500)) is null,
    "Delayed-rate detector must wait for touchdown");
Check(delayedRateDetector.Observe(Sample(startedAt.AddSeconds(3), true, 3, -750, 0)) is null,
    "The detector must wait for the peak-G window");
var delayedReport = delayedRateDetector.Observe(Sample(startedAt.AddSeconds(3.6), true, 3, 0, 0));
Check(delayedReport is not null, "A zero touchdown-rate frame must still emit a landing report");
Check(delayedReport!.LandingRateFpm == 750, "The vertical-speed fallback must populate the landing rate");
Check(delayedReport.AircraftTitle.StartsWith("FenixA319", StringComparison.Ordinal),
    "The fallback report must retain the Fenix aircraft identity");

Check(SimConnectReader.MergeParkingBrake(false, false, true) == true,
    "The PMDG parking-brake lever must override stale standard SimVars");
Check(SimConnectReader.MergeParkingBrake(false, true, false) == true,
    "The standard parking-brake indicator must override a stale position value");
Check(SimConnectReader.MergeParkingBrake(false, false, false) == false,
    "Parking brake must remain released when every available source is false");
Check(SimConnectReader.MergeParkingBrake(null, null, null) is null,
    "Parking brake must remain unavailable when no source is available");
Check(SimConnectReader.NormalizePercent(-5) == 0, "Equipment percentages must clamp below zero");
Check(SimConnectReader.NormalizePercent(42.5) == 42.5, "Equipment percentages must retain valid positions");
Check(SimConnectReader.NormalizePercent(140) == 100, "Equipment percentages must clamp above one hundred");

Console.WriteLine("Telemetry landing detector and multi-source parking brake passed");
