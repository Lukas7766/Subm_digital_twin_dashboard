import React, { useState, useEffect } from "react";
import { Box, Typography, Card, CardContent, Grid, Divider, Paper, Button, Stack, TextField, FormControl, InputLabel, Select, MenuItem, LinearProgress} from "@mui/material";
import { Line } from "react-chartjs-2";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const PRINTER_STATUS_API = "http://localhost:5000/dashboard/printer-status";
const JOBS_API = "http://localhost:5000/dashboard/jobs";
const STREAM_URL = "http://192.168.0.106:8080/?action=stream";
const RATE_PRINT_API = "http://localhost:5000/dashboard/rate-job";

const PAUSE_PRINT_API = "http://localhost:5000/dashboard/pause";
const PREHEAT_NOZZLE_API = "http://localhost:5000/dashboard/preheat";
const CONTINUE_PRINT_API = "http://localhost:5000/dashboard/continue";
const CANCEL_PRINT_API = "http://localhost:5000/dashboard/cancel";


interface Job {
    id: number;
    file_name: string;
    status: string;
    start_time: string;
    end_time?: string | null;
    filament_used?: number;
    progress?: number;
    estimated_completion_time?: number;
}

interface PrinterStatus {
    state: string;
    nozzle_temperature: number;
    bed_temperature: number;
    operational: boolean;
    printing: boolean;
    paused: boolean;
}

const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return "N/A";

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};


const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return "In Progress";
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
};

const Dashboard: React.FC = () => {
    const [printerData, setPrinterData] = useState<PrinterStatus | null>(null);
    const [jobHistory, setJobHistory] = useState<Job[]>([]);
    const [currentJob, setCurrentJob] = useState<Job | null>(null);
    const [temperatureData, setTemperatureData] = useState<{ time: string; nozzle: number; bed: number }[]>([]);
    const [lastValidCommand, setLastValidCommand] = useState<string | null>(null);
    const [nextValidCommand, setNextValidCommand] = useState<string>("");
    const [rating, setRating] = useState({
        quality: "",
        speed: "",
        feedback: "",
        jobId: null as number | null,
    });

    const fetchPrinterStatus = async () => {
        try {
            const response = await fetch(PRINTER_STATUS_API);
            if (!response.ok) throw new Error("Failed to fetch printer status");
            const data: PrinterStatus = await response.json();
            setPrinterData(data);

            setTemperatureData((prevData) => [
                ...prevData.slice(-19),
                {
                    time: new Date().toLocaleTimeString(),
                    nozzle: data.nozzle_temperature,
                    bed: data.bed_temperature,
                },
            ]);

        } catch (error) {
            console.error("Error fetching printer status:", error);
        }
    };

    const fetchJobs = async () => {
        try {
            const response = await fetch(JOBS_API);
            if (!response.ok) throw new Error("Failed to fetch jobs");
            const jobs: Job[] = await response.json();

            // Sort jobs by start time (newest first)
            jobs.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

            setJobHistory(jobs);

            // Find ongoing job
            let ongoingJob = jobs.find(
                (job) => (job.status === "STARTED" || job.status === "RESUMED" || job.status === "PAUSED") && job.end_time === null
            );

            // If no ongoing job but previous one was being tracked, check if it has finished
            if (!ongoingJob && currentJob && (currentJob.status === "STARTED" || currentJob.status === "RESUMED" || currentJob.status === "PAUSED")) {
                const updatedJob = jobs.find((job) => job.id === currentJob.id);

                if (updatedJob && (updatedJob.status === "FINISHED" || updatedJob.status === "FAILED")) {
                    console.log("Print job completed! Resetting live metrics.");
                    ongoingJob = undefined; // Reset live metrics
                }
            }

            setCurrentJob(ongoingJob || null);
        } catch (error) {
            console.error("Error fetching jobs:", error);
        }
    };

    const estimatedEndTime =
        currentJob && currentJob.start_time && currentJob.estimated_completion_time !== undefined
            ? new Date(new Date(currentJob.start_time).getTime() + currentJob.estimated_completion_time * 1000)
            : null;

    const sendCommand = async (endpoint: string, successMessage: string) => {
        try {
            const response = await fetch(endpoint, { method: "POST" });
            if (!response.ok) throw new Error("Command failed");
            alert(successMessage);
            fetchPrinterStatus(); // Refresh printer status after command
        } catch (error) {
            console.error("Error sending command:", error);
            alert("Command failed. Check logs.");
        }
    };

    const submitRating = async () => {
        if (!rating.jobId) {
            alert("No job selected for rating.");
            return;
        }

        const payload = {
            jobId: rating.jobId,
            printQuality: parseFloat(rating.quality),
            printSpeed: parseFloat(rating.speed),
            feedback: rating.feedback,
        };

        try {
            const response = await fetch(RATE_PRINT_API, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) throw new Error("Failed to submit rating");

            alert("Print rating submitted successfully!");
            setRating({ quality: "", speed: "", feedback: "", jobId: rating.jobId });
        } catch (error) {
            console.error("Error submitting print rating:", error);
            alert("Failed to submit rating.");
        }
    };

    const downloadTimelapse = async (jobId: number) => {
        try {
            const response = await fetch(`http://localhost:5000/dashboard/timelapse?jobId=${jobId}`, {
                method: "GET",
            });
            if (!response.ok) throw new Error("Failed to download timelapse");

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `timelapse_${jobId}.mp4`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (error) {
            console.error("Error downloading timelapse:", error);
            alert("Failed to download timelapse.");
        }
    };

    const downloadPhotos = async (jobId: number) => {
        try {
            const response = await fetch(`http://localhost:5000/dashboard/pictureHistory?jobId=${jobId}`, {
                method: "GET",
            });
            if (!response.ok) throw new Error("Failed to download photos");

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `photos_${jobId}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (error) {
            console.error("Error downloading photos:", error);
            alert("Failed to download photos.");
        }
    };

    const fetchLastValidCommand = async () => {
        try {
            const response = await fetch("http://localhost:5000/dashboard/last-valid");
            if (!response.ok) throw new Error("Failed to fetch last valid command");

            const data = await response.json();
            setLastValidCommand(data.command);
        } catch (error) {
            console.error("Error fetching last valid command:", error);
            setLastValidCommand("Error fetching command.");
        }
    };

    const submitNextValidCommand = async () => {
        if (!nextValidCommand.trim()) {
            alert("Please enter a valid command.");
            return;
        }

        try {
            const response = await fetch("http://localhost:5000/dashboard/next-valid", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ command: nextValidCommand }),
            });

            if (!response.ok) throw new Error("Failed to submit next valid command");

            alert("Next valid command submitted successfully!");
            setNextValidCommand(""); // Reset input after submission
        } catch (error) {
            console.error("Error submitting next valid command:", error);
            alert("Failed to submit next valid command.");
        }
    };

    useEffect(() => {
        fetchPrinterStatus();
        fetchJobs();
        fetchLastValidCommand();

        const interval = setInterval(() => {
            fetchPrinterStatus();
            fetchJobs();
            fetchLastValidCommand();
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    return (
        <Box sx={{ padding: 4, backgroundColor: "#f9f9f9", minHeight: "100vh" }}>
            <Typography variant="h3" gutterBottom>
                3D Printer Dashboard
            </Typography>
            <Grid container spacing={4}>
                {/* Left Column - Printer Status & Video Feed */}
                <Grid item xs={12} md={6}>
                    <Card sx={{ padding: 3, boxShadow: 3, borderRadius: "12px" }}>
                        <CardContent>
                            <Box sx={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
                                <img
                                    src="/3d_printer.svg"
                                    alt="3D Printer"
                                    style={{ width: "100px", height: "100px", marginRight: "16px", objectFit: "contain" }}
                                />
                                <Box>
                                    <Typography variant="h5" sx={{ fontWeight: "bold", color: "#1976d2" }}>
                                        3D Printer Live Status
                                    </Typography>
                                    <Typography sx={{ fontSize: "0.875rem", color: "gray" }}>
                                        Monitoring in real-time
                                    </Typography>
                                </Box>
                            </Box>
                            <Divider sx={{ marginY: 2 }} />
                            {printerData ? (
                                <>
                                    <Typography>
                                        <strong>Nozzle Temp:</strong> {printerData.nozzle_temperature}°C
                                    </Typography>
                                    <Typography>
                                        <strong>Bed Temp:</strong> {printerData.bed_temperature}°C
                                    </Typography>
                                    <Typography>
                                        <strong>Printer State:</strong>{" "}
                                        <span
                                            style={{
                                                color:
                                                    printerData.state === "Printing"
                                                        ? "blue"
                                                        : printerData.state === "Idle"
                                                            ? "orange"
                                                            : printerData.state === "Error"
                                                                ? "red"
                                                                : "green",
                                                fontWeight: "bold",
                                            }}
                                        >
                                            {printerData.state}
                                        </span>
                                    </Typography>

                                    {/* Control Buttons */}
                                    <Stack spacing={2} direction="row" sx={{ marginY: 2 }}>
                                        <Button
                                            variant="contained"
                                            color="warning"
                                            onClick={() => sendCommand(PAUSE_PRINT_API, "Print paused.")}
                                            disabled={!printerData.printing || printerData.paused}
                                        >
                                            Pause Print
                                        </Button>

                                        <Button
                                            variant="contained"
                                            color="primary"
                                            onClick={() => sendCommand(PREHEAT_NOZZLE_API, "Nozzle preheating started.")}
                                        >
                                            Preheat Nozzle 
                                        </Button>

                                        <Button
                                            variant="contained"
                                            color="success"
                                            onClick={() => sendCommand(CONTINUE_PRINT_API, "Print resumed.")}
                                            disabled={!printerData.paused}
                                        >
                                            Continue Print
                                        </Button>

                                        <Button
                                            variant="contained"
                                            color="error"
                                            onClick={() => sendCommand(CANCEL_PRINT_API, "Print canceled.")}
                                            disabled={!printerData.printing && !printerData.paused} // 🔹 Disable if no active print
                                        >
                                            Cancel Print
                                        </Button>
                                    </Stack>
                                    <Divider sx={{ marginY: 2 }} />

                                    {/* Temperature Graph */}
                                    <Typography sx={{ fontSize: "1rem", fontWeight: "bold", marginBottom: 1 }}>
                                        Temperature Graph
                                    </Typography>
                                    <div style={{height: "200px", width: "100%"}}>
                                        <Line
                                            data={{
                                                labels: temperatureData.map((entry) => entry.time),
                                                datasets: [
                                                    {
                                                        label: "Nozzle Temperature (°C)",
                                                        data: temperatureData.map((entry) => entry.nozzle),
                                                        borderColor: "red",
                                                        fill: false,
                                                    },
                                                    {
                                                        label: "Bed Temperature (°C)",
                                                        data: temperatureData.map((entry) => entry.bed),
                                                        borderColor: "blue",
                                                        fill: false,
                                                    },
                                                ],
                                            }}
                                            options={{
                                                maintainAspectRatio: false,
                                                responsive: true,
                                                scales: {
                                                    y: {
                                                        min: 0,
                                                        max: 300,
                                                        ticks: {
                                                            stepSize: 50,
                                                        },
                                                    },
                                                },
                                            }}
                                        />
                                    </div>

                                    <Divider sx={{ marginY: 2 }} />
                                    {/* Live Metrics */}
                                    {currentJob ? (
                                        <Paper sx={{ padding: 2, backgroundColor: "#eef2f6", borderRadius: "8px", marginBottom: 2 }}>
                                            <Typography variant="h6" sx={{ fontWeight: "bold", marginBottom: 1 }}>
                                                Live Print Metrics
                                            </Typography>
                                            <Typography><strong>File:</strong> {currentJob.file_name}</Typography>

                                            <Typography>
                                                <strong>Estimated Print Time:</strong> {currentJob?.start_time ? formatTimestamp(currentJob.start_time) : "N/A"} →{" "}
                                                {estimatedEndTime ? formatTimestamp(estimatedEndTime.toISOString()) : "N/A"}
                                            </Typography>

                                            <Typography>
                                                <strong>Estimated Filament Use:</strong> {currentJob.filament_used?.toFixed(2) || "N/A"} mm
                                            </Typography>

                                            <Typography><strong>Progress:</strong> {currentJob.progress?.toFixed(1) || 0}%</Typography>

                                            <LinearProgress
                                                variant="determinate"
                                                value={currentJob.progress || 0}
                                                sx={{ marginTop: 1, height: 8 }}
                                            />
                                        </Paper>
                                    ) : (
                                        <Typography sx={{ fontStyle: "italic", color: "gray", marginBottom: 2 }}>
                                            No active print job.
                                        </Typography>
                                    )}

                                    {/* Show Error Handling Box only when paused */}
                                    {printerData?.paused && (
                                        <Paper sx={{ padding: 2, backgroundColor: "#ffebee", borderRadius: "8px", marginTop: 2 }}>

                                            <Typography variant="h6" sx={{ fontWeight: "bold", marginBottom: 1, color: "#d32f2f" }}>
                                                Error Handling
                                            </Typography>

                                            {/* Last Valid Command */}
                                            <Typography>
                                                <strong>Last Valid Command:</strong> {lastValidCommand || "Fetching..."}
                                            </Typography>

                                            {/* Input for Next Valid Command */}
                                            <Stack direction="row" spacing={2} sx={{ marginTop: 2 }}>
                                                <TextField
                                                    fullWidth
                                                    label="Enter Next Valid Command"
                                                    variant="outlined"
                                                    value={nextValidCommand}
                                                    onChange={(e) => setNextValidCommand(e.target.value)}
                                                />
                                                <Button
                                                    variant="contained"
                                                    color="primary"
                                                    onClick={submitNextValidCommand}
                                                >
                                                    Submit
                                                </Button>
                                            </Stack>
                                        </Paper>
                                    )}


                                    <Divider sx={{marginY: 2}}/>

                                    {/* Video Feed */}
                                    <Typography sx={{fontSize: "1rem", fontWeight: "bold", marginBottom: 1}}>
                                        Live Camera Feed
                                    </Typography>
                                    <img
                                        src={STREAM_URL}
                                        alt="3D Printer Live Stream"
                                        style={{
                                            width: "100%",
                                            height: "350px",
                                            objectFit: "contain",
                                            border: "1px solid #ccc",
                                            borderRadius: "8px",
                                        }}
                                    />
                                </>
                            ) : (
                                <Typography>Loading printer status...</Typography>
                            )}
                        </CardContent>
                    </Card>
                </Grid>

                {/* Right Column - Job History */}
                <Grid item xs={12} md={6}>
                    <Paper
                        sx={{
                            padding: 3,
                            boxShadow: 3,
                            borderRadius: "12px",
                            height: "600px", // Fixed height
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        {/* Pinned Header */}
                        <Box sx={{ flexShrink: 0 }}>
                            <Typography variant="h5" sx={{ fontWeight: "bold" }}>
                                Job History
                            </Typography>
                            <Divider />
                        </Box>

                        {/* Scrollable Job List */}
                        <Box sx={{ flexGrow: 1, overflowY: "auto", paddingRight: 1 }}>
                            {jobHistory.length > 0 ? (
                                jobHistory.map((job) => (
                                    <Card
                                        key={job.id}
                                        sx={{
                                            marginTop: 2,
                                            padding: 2,
                                            boxShadow: 1,
                                            borderRadius: "8px",
                                            backgroundColor: job.status === "STARTED" ? "#d1e5ff" : "#fff",
                                        }}
                                    >
                                        <Typography>
                                            <strong>Job ID:</strong> {job.id}
                                        </Typography>
                                        <Typography>
                                            <strong>File:</strong> {job.file_name}
                                        </Typography>
                                        <Typography>
                                            <strong>Status:</strong>{" "}
                                            <span
                                                style={{
                                                    color: job.status === "FINISHED" ? "green" : job.status === "FAILED" ? "red" : "blue",
                                                    fontWeight: "bold",
                                                }}
                                            >
                            {job.status}
                        </span>
                                        </Typography>
                                        {/* Filament Used */}
                                        {job.filament_used !== null && job.filament_used !== undefined && (
                                            <Typography>
                                                <strong>Filament Used:</strong> {job.filament_used.toFixed(2)}mm
                                            </Typography>
                                        )}
                                        <Typography variant="caption" sx={{ color: "gray" }}>
                                            {formatTimestamp(job.start_time)} →{" "}
                                            {formatTimestamp(
                                                job.start_time && job.estimated_completion_time
                                                    ? new Date(new Date(job.start_time).getTime() + job.estimated_completion_time * 1000)
                                                        .toISOString()
                                                        .replace("T", " ")
                                                        .split(".")[0]
                                                    : null
                                            )}
                                        </Typography>
                                        <Divider sx={{ marginY: 2 }} />
                                        {/* Download Buttons */}
                                        <Stack direction="row" spacing={2} sx={{ marginTop: 2 }}>
                                            <Button
                                                variant="contained"
                                                color="primary"
                                                onClick={() => downloadTimelapse(job.id)}
                                            >
                                                Download Timelapse
                                            </Button>
                                            <Button
                                                variant="contained"
                                                color="secondary"
                                                onClick={() => downloadPhotos(job.id)}
                                            >
                                                Download Photos
                                            </Button>
                                        </Stack>
                                    </Card>
                                ))
                            ) : (
                                <Typography>No job history available.</Typography>
                            )}
                        </Box>
                    </Paper>
                    {/* Print Rating Box */}
                    <Paper sx={{ padding: 3, boxShadow: 3, borderRadius: "12px", marginTop: 3 }}>
                        <Typography variant="h5" sx={{ fontWeight: "bold" }}>
                            Print Rating
                        </Typography>
                        <Stack spacing={2} sx={{ marginTop: 2 }}>
                            <FormControl fullWidth>
                                <Select
                                    value={rating.jobId || ""}
                                    onChange={(e) => setRating({ ...rating, jobId: Number(e.target.value) })}
                                    displayEmpty
                                    renderValue={(selected) => (selected ? selected.toString() : "Select Job ID")}
                                >
                                    <MenuItem value="" disabled>-- Select Job --</MenuItem>
                                    {jobHistory.map((job) => (
                                        <MenuItem key={job.id} value={job.id}>
                                            {job.id} - {job.file_name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            <TextField
                                label="Print Quality (1-10)"
                                type="number"
                                value={rating.quality}
                                onChange={(e) => setRating({ ...rating, quality: e.target.value })}
                            />

                            <TextField
                                label="Print Speed (1-10)"
                                type="number"
                                value={rating.speed}
                                onChange={(e) => setRating({ ...rating, speed: e.target.value })}
                            />

                            <TextField
                                label="Feedback"
                                multiline
                                rows={3}
                                value={rating.feedback}
                                onChange={(e) => setRating({ ...rating, feedback: e.target.value })}
                            />

                            <Button
                                variant="contained"
                                color="primary"
                                onClick={submitRating}
                                disabled={!rating.jobId}
                            >
                                Submit
                            </Button>
                        </Stack>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Dashboard;