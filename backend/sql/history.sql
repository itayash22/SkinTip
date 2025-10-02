-- Add is_admin column to users table
ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;

-- Drop existing tables if they were created with the wrong types, to start clean
DROP TABLE IF EXISTS flux_settings_history;
DROP TABLE IF EXISTS flux_settings;
DROP TABLE IF EXISTS flux_presets;

-- Create the flux_settings table
CREATE TABLE IF NOT EXISTS flux_settings (
    id SERIAL PRIMARY KEY,
    settings JSONB NOT NULL,
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create the flux_settings_history table
CREATE TABLE IF NOT EXISTS flux_settings_history (
    id SERIAL PRIMARY KEY,
    settings_id INT NOT NULL,
    old_settings JSONB,
    new_settings JSONB NOT NULL,
    changed_by UUID,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (settings_id) REFERENCES flux_settings(id),
    FOREIGN KEY (changed_by) REFERENCES users(id)
);

-- Create a trigger function to log history
CREATE OR REPLACE FUNCTION log_flux_settings_change()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO flux_settings_history (settings_id, old_settings, new_settings, changed_by)
    VALUES (NEW.id, OLD.settings, NEW.settings, NEW.updated_by);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger that calls the function
CREATE TRIGGER flux_settings_history_trigger
AFTER UPDATE ON flux_settings
FOR EACH ROW
WHEN (OLD.settings IS DISTINCT FROM NEW.settings)
EXECUTE FUNCTION log_flux_settings_change();

-- Insert initial settings
INSERT INTO flux_settings (settings) VALUES ('{
    "prompt": "Preserve the exact silhouette, proportions and interior details of the tattoo. Blend it realistically into the skin with lighting, micro-shadowing and subtle ink diffusion. Do not redraw, restyle or resize. Keep the original tonal balance and colors; avoid pure white ink effects or global darkening.",
    "behaviorFlags": {
        "adaptiveScaleEnabled": true,
        "adaptiveEngineEnabled": true,
        "globalScaleUp": 1.5,
        "fluxEngineDefault": "kontext"
    },
    "engineSizeBias": {
        "kontext": 1.08,
        "fill": 1.02
    },
    "maskGrow": {
        "pct": 0.06,
        "min": 4,
        "max": 28
    },
    "bakeTuning": {
        "brightness": 1.0,
        "gamma": 1.0,
        "overlayOpacity": 0.28,
        "softlightOpacity": 0.22,
        "multiplyOpacity": 0.06
    }
}');

-- Set a user as admin
UPDATE users SET is_admin = TRUE WHERE email = 'itayash@gmail.com';

-- Create the flux_presets table
CREATE TABLE IF NOT EXISTS flux_presets (
    id SERIAL PRIMARY KEY,
    preset_name VARCHAR(255) NOT NULL,
    parameters JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);