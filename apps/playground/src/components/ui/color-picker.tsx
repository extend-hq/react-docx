import React, { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "apps/playground/src/lib/utils";

import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

// Helper functions for color conversion
const hslToHex = (h: number, s: number, l: number) => {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const hexToHsl = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
};

const normalizeColor = (color: string): string => {
  if (color.startsWith("#")) {
    return color.toUpperCase();
  } else if (color.startsWith("hsl")) {
    const [h, s, l] = color.match(/\d+(\.\d+)?/g)?.map(Number) || [0, 0, 0];
    return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
  }
  if (color.startsWith("rgb")) {
    const values = color.match(/\d+(\.\d+)?/g)?.map(Number) || [0, 0, 0];
    const hex = hslToHex(...rgbToHsl(values[0] || 0, values[1] || 0, values[2] || 0));
    return hex;
  }
  return color;
};

const trimColorString = (color: string, maxLength: number = 20): string => {
  if (color.length <= maxLength) return color;
  return `${color.slice(0, maxLength - 3)}...`;
};

type ColorPickerMode = "hex" | "rgb" | "hsl" | "css";

const MODE_OPTIONS: ColorPickerMode[] = ["hex", "rgb", "css", "hsl"];

const clampToByte = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(value)));

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const normalizedHue = (((h % 360) + 360) % 360) / 360;
  const saturation = Math.max(0, Math.min(100, s)) / 100;
  const lightness = Math.max(0, Math.min(100, l)) / 100;

  const hueToRgb = (p: number, q: number, tValue: number): number => {
    let t = tValue;
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }

    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }

    return p;
  };

  if (saturation === 0) {
    const base = clampToByte(lightness * 255);
    return [base, base, base];
  }

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const red = hueToRgb(p, q, normalizedHue + 1 / 3);
  const green = hueToRgb(p, q, normalizedHue);
  const blue = hueToRgb(p, q, normalizedHue - 1 / 3);

  return [clampToByte(red * 255), clampToByte(green * 255), clampToByte(blue * 255)];
};

const formatColorFromHsl = (
  hslColor: [number, number, number],
  mode: ColorPickerMode
): string => {
  const [h, s, l] = hslColor;
  const [red, green, blue] = hslToRgb(h, s, l);

  if (mode === "hex") {
    return hslToHex(h, s, l);
  }
  if (mode === "rgb") {
    return `rgb(${red}, ${green}, ${blue})`;
  }
  if (mode === "css") {
    return `rgba(${red}, ${green}, ${blue}, 1)`;
  }

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
};

const rgbToHsl = (red: number, green: number, blue: number): [number, number, number] => {
  const r = clampToByte(red) / 255;
  const g = clampToByte(green) / 255;
  const b = clampToByte(blue) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const delta = max - min;
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / delta + 2) / 6;
    } else {
      h = ((r - g) / delta + 4) / 6;
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
};

function parseColorToHsl(color: string): [number, number, number] {
  const normalizedColor = normalizeColor(color);
  if (normalizedColor.startsWith("#")) {
    return hexToHsl(normalizedColor);
  }

  const rgbMatch = normalizedColor
    .match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*\d+(?:\.\d+)?)?\s*\)$/i
    )
    ?.map(Number);
  if (rgbMatch?.length) {
    return rgbToHsl(rgbMatch[1], rgbMatch[2], rgbMatch[3]);
  }

  const values = normalizedColor.match(/\d+(\.\d+)?/g)?.map(Number) || [0, 0, 0];
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

type ColorPickerProps = {
  color: string;
  onChange: (color: string) => void;
  triggerClassName?: string;
  contentClassName?: string;
  onTriggerMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
  onTriggerPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  defaultMode?: ColorPickerMode;
  mode?: ColorPickerMode;
};

export function ColorPicker({
  color,
  onChange,
  triggerClassName,
  contentClassName,
  onTriggerMouseDown,
  onTriggerPointerDown,
  defaultMode = "hex",
  mode,
}: ColorPickerProps) {
  const [hsl, setHsl] = useState<[number, number, number]>([0, 0, 0]);
  const [colorInput, setColorInput] = useState(color);
  const [isOpen, setIsOpen] = useState(false);
  const [internalMode, setInternalMode] = useState<ColorPickerMode>(defaultMode);
  const selectedMode = mode ?? internalMode;

  useEffect(() => {
    if (isOpen) {
      return;
    }

    const normalizedColor = normalizeColor(color);
    const parsed = parseColorToHsl(normalizedColor);
    setHsl(parsed);
    setColorInput(formatColorFromHsl(parsed, selectedMode));
  }, [color, isOpen, selectedMode]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const normalizedColor = normalizeColor(color);
    const parsed = parseColorToHsl(normalizedColor);
    setHsl(parsed);
    setColorInput(formatColorFromHsl(parsed, selectedMode));
  }, [color, isOpen, selectedMode]);

  const handleColorChange = (newColor: string) => {
    const normalizedColor = normalizeColor(newColor);
    const [h, s, l] = parseColorToHsl(normalizedColor);
    setHsl([h, s, l]);
    const formatted = formatColorFromHsl([h, s, l], selectedMode);
    setColorInput(formatted);
    onChange(formatted);
  };

  const handleHueChange = (hue: number) => {
    const newHsl: [number, number, number] = [hue, hsl[1], hsl[2]];
    setHsl(newHsl);
    handleColorChange(`hsl(${newHsl[0]}, ${newHsl[1]}%, ${newHsl[2]}%)`);
  };

  const handleSaturationLightnessChange = (
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const s = Math.round((x / rect.width) * 100);
    const l = Math.round(100 - (y / rect.height) * 100);
    const newHsl: [number, number, number] = [hsl[0], s, l];
    setHsl(newHsl);
    handleColorChange(`hsl(${newHsl[0]}, ${newHsl[1]}%, ${newHsl[2]}%)`);
  };

  const handleColorInputChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const newColor = event.target.value;
    setColorInput(newColor);
    if (
      /^#[0-9A-Fa-f]{6}$/.test(newColor) ||
      /^#[0-9A-Fa-f]{3}$/.test(newColor) ||
      /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*\d+(?:\.\d+)?)?\s*\)$/i.test(
        newColor
      ) ||
      /^hsla?\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?%\s*,\s*-?\d+(?:\.\d+)?%(?:\s*\/\s*-?\d+(?:\.\d+)?%?)?\s*\)$/i.test(
        newColor
      )
    ) {
      handleColorChange(newColor);
    }
  };

  const handleModeChange = (value: ColorPickerMode | null) => {
    if (!value) {
      return;
    }

    const nextMode = value;
    if (!mode) {
      setInternalMode(nextMode);
    }
    setColorInput(formatColorFromHsl(hsl, nextMode));
  };

  const colorPresets = [
    "#FF3B30",
    "#FF9500",
    "#FFCC00",
    "#4CD964",
    "#5AC8FA",
    "#007AFF",
    "#5856D6",
    "#FF2D55",
    "#8E8E93",
    "#EFEFF4",
    "#E5E5EA",
    "#D1D1D6",
  ];

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            onMouseDown={onTriggerMouseDown}
            onPointerDown={onTriggerPointerDown}
            className={cn(
              "w-[180px] justify-start text-left font-normal",
              triggerClassName
            )}
          />
        }
        >
          <div
            className="w-4 h-4 rounded-full mr-2 shadow-sm"
            style={{ backgroundColor: colorInput }}
          />
          <span className="min-w-0 flex-1 truncate">{trimColorString(colorInput)}</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </PopoverTrigger>
      <PopoverContent className={cn("w-[240px] p-3", contentClassName)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Mode</span>
            <Select value={selectedMode} onValueChange={handleModeChange}>
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue placeholder="Mode" />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((format) => (
                  <SelectItem key={format} value={format} className="text-xs">
                    {format.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <motion.div
            className="w-full h-40 rounded-lg cursor-crosshair relative overflow-hidden"
            style={{
              background: `
                linear-gradient(to top, rgba(0, 0, 0, 1), transparent),
                linear-gradient(to right, rgba(255, 255, 255, 1), rgba(255, 0, 0, 0)),
                hsl(${hsl[0]}, 100%, 50%)
              `,
            }}
            onClick={handleSaturationLightnessChange}
          >
            <motion.div
              className="w-4 h-4 rounded-full border-2 border-white absolute shadow-md"
              style={{
                left: `${hsl[1]}%`,
                top: `${100 - hsl[2]}%`,
                backgroundColor: `hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`,
              }}
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.9 }}
            />
          </motion.div>
          <input
            type="range"
            min="0"
            max="360"
            value={hsl[0]}
            onInput={(event) =>
              handleHueChange(Number((event.currentTarget as HTMLInputElement).value))
            }
            onChange={(e) => handleHueChange(Number(e.target.value))}
            className="w-full h-3 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, 
                hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%), 
                hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%)
              )`,
            }}
          />
          <div className="flex items-center space-x-2">
            <Label htmlFor="color-input" className="sr-only">
              Color
            </Label>
            <Input
              id="color-input"
              type="text"
              value={colorInput}
              onChange={handleColorInputChange}
              className="flex-grow bg-white border border-gray-300 rounded-md text-sm h-8 px-2"
              placeholder={`${selectedMode.toUpperCase()} value`}
            />
            <motion.div
              className="w-8 h-8 rounded-md shadow-sm"
              style={{ backgroundColor: colorInput }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            />
          </div>
          <div className="grid grid-cols-6 gap-2">
            <AnimatePresence>
              {colorPresets.map((preset) => (
                <motion.button
                  key={preset}
                  className="w-8 h-8 rounded-full relative"
                  style={{ backgroundColor: preset }}
                  onClick={() => handleColorChange(preset)}
                  whileHover={{ scale: 1.2, zIndex: 1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  {colorInput.toUpperCase() === preset.toUpperCase() && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Check className="w-4 h-4 text-white absolute inset-0 m-auto" />
                    </motion.div>
                  )}
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}

export default ColorPicker;
