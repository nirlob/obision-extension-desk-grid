import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ObisionExtensionDeskPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'user-desktop-symbolic',
        });
        window.add(page);

        // Icon Settings Group
        const iconGroup = new Adw.PreferencesGroup({
            title: 'Icon Settings',
            description: 'Configure desktop icon appearance',
        });
        page.add(iconGroup);

        // Icon Size
        const iconSizeRow = new Adw.ComboRow({
            title: 'Icon Size',
            subtitle: 'Size of desktop icons',
        });
        const sizeModel = new Gtk.StringList();
        sizeModel.append('Small (48px)');
        sizeModel.append('Medium (64px)');
        sizeModel.append('Large (96px)');
        sizeModel.append('Extra Large (128px)');
        iconSizeRow.set_model(sizeModel);

        // Map settings value to index
        const sizeMap = { small: 0, medium: 1, large: 2, xlarge: 3 };
        const reverseSizeMap = ['small', 'medium', 'large', 'xlarge'];
        const currentSize = settings.get_string('icon-size');
        iconSizeRow.set_selected(sizeMap[currentSize] ?? 1);

        iconSizeRow.connect('notify::selected', () => {
            const selected = iconSizeRow.get_selected();
            settings.set_string('icon-size', reverseSizeMap[selected]);
        });
        iconGroup.add(iconSizeRow);

        // Show Hidden Files
        const showHiddenRow = new Adw.SwitchRow({
            title: 'Show Hidden Files',
            subtitle: 'Display files and folders starting with a dot',
        });
        iconGroup.add(showHiddenRow);
        settings.bind('show-hidden', showHiddenRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Grid Settings Group
        const gridGroup = new Adw.PreferencesGroup({
            title: 'Grid Settings',
            description: 'Configure icon grid layout',
        });
        page.add(gridGroup);

        // Grid Spacing
        const gridSpacingRow = new Adw.SpinRow({
            title: 'Grid Spacing',
            subtitle: 'Space between icons in pixels',
            adjustment: new Gtk.Adjustment({
                lower: 4,
                upper: 48,
                step_increment: 2,
                page_increment: 8,
            }),
        });
        gridGroup.add(gridSpacingRow);
        settings.bind('grid-spacing', gridSpacingRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Sort By
        const sortByRow = new Adw.ComboRow({
            title: 'Sort By',
            subtitle: 'How to sort desktop icons',
        });
        const sortModel = new Gtk.StringList();
        sortModel.append('Name');
        sortModel.append('Modified Date');
        sortModel.append('Size');
        sortModel.append('Type');
        sortByRow.set_model(sortModel);

        const sortMap = { name: 0, modified: 1, size: 2, type: 3 };
        const reverseSortMap = ['name', 'modified', 'size', 'type'];
        const currentSort = settings.get_string('sort-by');
        sortByRow.set_selected(sortMap[currentSort] ?? 0);

        sortByRow.connect('notify::selected', () => {
            const selected = sortByRow.get_selected();
            settings.set_string('sort-by', reverseSortMap[selected]);
        });
        gridGroup.add(sortByRow);

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
