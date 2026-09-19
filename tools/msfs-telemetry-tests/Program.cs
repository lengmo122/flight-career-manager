using SkylineVA.Msfs2024Telemetry;

var start = new DateTimeOffset(2026, 8, 21, 0, 0, 0, TimeSpan.Zero);

DoesNotArmAtFiftyFeet();
CapturesFlowCompatibleTouchdown();
CountsBounce();
CountsLateSecondContactWithoutCreatingAnotherLanding();

Console.WriteLine("P42 landing detector tests passed.");

void DoesNotArmAtFiftyFeet()
{
    var detector = CreateDetector();
    detector.Observe(Sample(start, onGround: true));
    detector.Observe(Sample(start.AddMilliseconds(500), onGround: false, clearanceFt: 0));
    detector.Observe(Sample(start.AddSeconds(1), onGround: false, clearanceFt: 50));
    detector.Observe(Sample(start.AddSeconds(2), onGround: true, landingRateFpm: 300));
    var report = detector.Observe(Sample(start.AddSeconds(3), onGround: true));
    Require(report is null, "50 ft must not arm the detector");
}

void CapturesFlowCompatibleTouchdown()
{
    var detector = CreateDetector();
    detector.Observe(Sample(start, onGround: true));
    detector.Observe(Sample(start.AddMilliseconds(500), onGround: false, clearanceFt: 0));
    detector.Observe(Sample(start.AddSeconds(1), onGround: false, clearanceFt: 51, groundSpeedKt: 0, gForce: 0.98));
    detector.Observe(Sample(start.AddSeconds(2), onGround: false, clearanceFt: 10, gForce: 1.01));
    var touchdownAt = start.AddSeconds(3);
    detector.Observe(Sample(touchdownAt, onGround: true, landingRateFpm: -245, gForce: 1.10));
    detector.Observe(Sample(touchdownAt.AddMilliseconds(200), onGround: true, landingRateFpm: -245, gForce: 1.40));
    detector.Observe(Sample(touchdownAt.AddMilliseconds(400), onGround: true, landingRateFpm: -245, gForce: 1.82));
    var report = detector.Observe(Sample(touchdownAt.AddMilliseconds(500), onGround: true, landingRateFpm: -245, gForce: 1.60));

    Require(report is not null, "landing report should be emitted after 500 ms");
    Require(report!.LandingRateFpm == 245, "touchdown normal velocity should be used directly");
    Require(Math.Abs(report.PeakG - 1.82) < 0.001, "peak G should come from the 500 ms touchdown window");
    Require(report.BounceCount == 0, "normal landing should not count a bounce");
    Require(report.Detector == "p42-landing-rate-engine", "the supplied P42 detector should be serialized");
}

void CountsBounce()
{
    var detector = CreateDetector();
    detector.Observe(Sample(start, onGround: true));
    detector.Observe(Sample(start.AddMilliseconds(500), onGround: false, clearanceFt: 0));
    detector.Observe(Sample(start.AddSeconds(1), onGround: false, clearanceFt: 60));
    var touchdownAt = start.AddSeconds(2);
    detector.Observe(Sample(touchdownAt, onGround: true, landingRateFpm: 180, gForce: 1.2));
    detector.Observe(Sample(touchdownAt.AddMilliseconds(100), onGround: false, clearanceFt: 0.2, gForce: 0.9));
    detector.Observe(Sample(touchdownAt.AddMilliseconds(200), onGround: true, landingRateFpm: 120, gForce: 1.5));
    var report = detector.Observe(Sample(touchdownAt.AddMilliseconds(500), onGround: true, gForce: 1.1));

    Require(report?.BounceCount == 1, "the second airborne-to-ground contact should count as one bounce");
}

void CountsLateSecondContactWithoutCreatingAnotherLanding()
{
    var detector = CreateDetector();
    detector.Observe(Sample(start, onGround: true));
    detector.Observe(Sample(start.AddMilliseconds(500), onGround: false, clearanceFt: 0));
    detector.Observe(Sample(start.AddSeconds(1), onGround: false, clearanceFt: 60));
    var touchdownAt = start.AddSeconds(2);
    detector.Observe(Sample(touchdownAt, onGround: true, landingRateFpm: 180, gForce: 1.2));
    detector.Observe(Sample(touchdownAt.AddMilliseconds(250), onGround: true, gForce: 1.4));
    var initialReport = detector.Observe(Sample(touchdownAt.AddMilliseconds(500), onGround: true, gForce: 1.1));
    detector.Observe(Sample(touchdownAt.AddMilliseconds(700), onGround: false, clearanceFt: 0.2, gForce: 0.9));
    var bounceReport = detector.Observe(Sample(touchdownAt.AddMilliseconds(900), onGround: true, landingRateFpm: 100, gForce: 1.3));

    Require(initialReport?.BounceCount == 0, "the first contact should initially have no bounce");
    Require(bounceReport?.BounceCount == 1, "the second contact should update the landing as one bounce");
    Require(bounceReport?.Timestamp == initialReport?.Timestamp, "bounce updates must retain the first touchdown timestamp");
}

P42LandingDetector CreateDetector() => new(new RunwayResolver(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"))));

TelemetrySample Sample(
    DateTimeOffset timestamp,
    bool onGround,
    double clearanceFt = 0,
    double landingRateFpm = 0,
    double groundSpeedKt = 0,
    double gForce = 1) => new(
        Timestamp: timestamp,
        AircraftTitle: "Test Helicopter",
        AircraftModel: "H125",
        Callsign: "TEST",
        Latitude: 0,
        Longitude: 0,
        HeadingDeg: 0,
        AltitudeFt: 0,
        RadioAltitudeFt: clearanceFt,
        GroundClearanceFt: clearanceFt,
        GroundSpeedKt: groundSpeedKt,
        IndicatedAirspeedKt: groundSpeedKt,
        VerticalSpeedFpm: 0,
        BodyVerticalSpeedFps: 0,
        WorldVerticalSpeedFps: 0,
        TouchdownNormalVelocityFpm: landingRateFpm,
        OnGround: onGround,
        EngineRunning: true,
        GForce: gForce,
        PitchDeg: 0,
        BankDeg: 0,
        FuelKg: 100,
        FuelCapacityKg: 200,
        SimulationRate: 1,
        SlewActive: false,
        RunwayAirport: "",
        RunwayDistanceM: -1,
        RunwayHeadingDeg: 0,
        RunwayEndDistanceM: -1);

void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
