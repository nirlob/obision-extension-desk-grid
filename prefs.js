import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Helper function to create a color picker with popover (no modal dialog)
function createColorPicker(settings, settingKey) {
    const button = new Gtk.MenuButton({
        valign: Gtk.Align.CENTER,
    });

    // Create a drawing area to show the current color
    const colorPreview = new Gtk.DrawingArea({
        width_request: 24,
        height_request: 24,
    });

    // Parse color and draw
    const updatePreview = () => {
        const colorStr = settings.get_string(settingKey);
        const rgba = new Gdk.RGBA();
        rgba.parse(colorStr);
        // Force opaque
        rgba.alpha = 1.0;

        colorPreview.set_draw_func((area, cr, width, height) => {
            // Draw color rectangle
            cr.setSourceRGBA(rgba.red, rgba.green, rgba.blue, 1.0);
            cr.rectangle(0, 0, width, height);
            cr.fill();
            // Draw border
            cr.setSourceRGBA(0.5, 0.5, 0.5, 1.0);
            cr.setLineWidth(1);
            cr.rectangle(0.5, 0.5, width - 1, height - 1);
            cr.stroke();
        });
        colorPreview.queue_draw();
    };

    updatePreview();
    button.set_child(colorPreview);

    // Create popover with color chooser widget
    const popover = new Gtk.Popover();
    const colorChooser = new Gtk.ColorChooserWidget({
        show_editor: true,
        use_alpha: false,
    });

    // Set initial color
    const initialColor = settings.get_string(settingKey);
    const rgba = new Gdk.RGBA();
    if (rgba.parse(initialColor)) {
        rgba.alpha = 1.0;
        colorChooser.set_rgba(rgba);
    }

    // Create a box with the color chooser and an apply button
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
    });

    box.append(colorChooser);

    const applyButton = new Gtk.Button({
        label: 'Apply',
        css_classes: ['suggested-action'],
    });

    applyButton.connect('clicked', () => {
        const newColor = colorChooser.get_rgba();
        // Force opaque color (no alpha)
        const opaqueColor = `rgb(${Math.round(newColor.red * 255)},${Math.round(newColor.green * 255)},${Math.round(newColor.blue * 255)})`;
        settings.set_string(settingKey, opaqueColor);
        updatePreview();
        popover.popdown();
    });

    box.append(applyButton);
    popover.set_child(box);
    button.set_popover(popover);

    return button;
}

export default class ObisionExtensionDeskPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Set window title
        window.set_title('Desktop Preferences');

        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'user-desktop-symbolic',
        });
        window.add(page);

        // Grid Settings Group
        const gridGroup = new Adw.PreferencesGroup({
            title: 'Grid Settings',
            description: 'Configure icon grid layout',
        });
        page.add(gridGroup);

        // Grid Columns
        const gridColumnsRow = new Adw.SpinRow({
            title: 'Grid Columns',
            subtitle: 'Number of columns in the desktop grid',
            adjustment: new Gtk.Adjustment({
                lower: 4,
                upper: 32,
                step_increment: 1,
                page_increment: 4,
            }),
        });
        gridGroup.add(gridColumnsRow);
        settings.bind('grid-columns', gridColumnsRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Grid Rows
        const gridRowsRow = new Adw.SpinRow({
            title: 'Grid Rows',
            subtitle: 'Number of rows in the desktop grid',
            adjustment: new Gtk.Adjustment({
                lower: 3,
                upper: 20,
                step_increment: 1,
                page_increment: 2,
            }),
        });
        gridGroup.add(gridRowsRow);
        settings.bind('grid-rows', gridRowsRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Grid Visible
        const gridVisibleRow = new Adw.SwitchRow({
            title: 'Show Grid',
            subtitle: 'Display the grid lines on the desktop',
        });
        gridGroup.add(gridVisibleRow);
        settings.bind('grid-visible', gridVisibleRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Grid Dots Only
        const gridDotsRow = new Adw.SwitchRow({
            title: 'Grid Dots Only',
            subtitle: 'Show only dots at intersections instead of lines',
        });
        gridGroup.add(gridDotsRow);
        settings.bind('grid-dots-only', gridDotsRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Grid Line Pattern
        const gridPatternRow = new Adw.ComboRow({
            title: 'Grid Line Pattern',
            subtitle: 'Pattern of grid lines (when dots only is off)',
        });
        const patternModel = new Gtk.StringList();
        patternModel.append('Solid');
        patternModel.append('Dashed');
        patternModel.append('Dotted');
        gridPatternRow.set_model(patternModel);

        const patternMap = { solid: 0, dashed: 1, dotted: 2 };
        const reversePatternMap = ['solid', 'dashed', 'dotted'];
        const currentPattern = settings.get_string('grid-line-pattern');
        gridPatternRow.set_selected(patternMap[currentPattern] ?? 0);

        gridPatternRow.connect('notify::selected', () => {
            const selected = gridPatternRow.get_selected();
            settings.set_string('grid-line-pattern', reversePatternMap[selected]);
        });
        gridGroup.add(gridPatternRow);

        // Grid Color with color picker
        const gridColorRow = new Adw.ActionRow({
            title: 'Grid Color',
            subtitle: 'Color of the grid lines',
        });
        const gridColorButton = createColorPicker(settings, 'grid-color');
        gridColorRow.add_suffix(gridColorButton);
        gridColorRow.activatable_widget = gridColorButton;
        gridGroup.add(gridColorRow);

        // Grid Line Width
        const gridLineWidthRow = new Adw.SpinRow({
            title: 'Grid Line Width',
            subtitle: 'Width of grid lines in pixels',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 4,
                step_increment: 1,
                page_increment: 1,
            }),
        });
        gridGroup.add(gridLineWidthRow);
        settings.bind('grid-line-width', gridLineWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Behavior Group
        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Behavior',
            description: 'Configure desktop behavior',
        });
        page.add(behaviorGroup);

        // Single Click to Open
        const singleClickRow = new Adw.SwitchRow({
            title: 'Single Click to Open',
            subtitle: 'Open files with a single click instead of double click',
        });
        behaviorGroup.add(singleClickRow);
        settings.bind('single-click', singleClickRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Show Trash Icon
        const showTrashRow = new Adw.SwitchRow({
            title: 'Show Trash Icon',
            subtitle: 'Display the trash can on desktop',
        });
        behaviorGroup.add(showTrashRow);
        settings.bind('show-trash', showTrashRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Show Home Icon
        const showHomeRow = new Adw.SwitchRow({
            title: 'Show Home Icon',
            subtitle: 'Display home folder on desktop',
        });
        behaviorGroup.add(showHomeRow);
        settings.bind('show-home', showHomeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}
