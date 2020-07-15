/*
 * VirtualBox search provider for Gnome shell 
 * Copyright (C) 2013 Gianrico Busa <busaster@gmail.com>
 * Copyright (C) 2020 Matthew Weier O'Phinney <matthew@weierophinney.net>
 * 
 * VirtualBox search provider is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * VirtualBox search provider is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License along
 * with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Thanks to gnekoz for his "VirtualBox machines launcher for Gnome shell" extension from which I took 
 * the new search engine based on vboxmanage invocation. 
 */

const ByteArray = imports.byteArray;
const Gio       = imports.gi.Gio;
const GLib      = imports.gi.GLib;
const Lang      = imports.lang;
const Main      = imports.ui.main;
const Search    = imports.ui.search;
const St        = imports.gi.St;
const Util      = imports.misc.util;

const KEY_FILE_GROUP = 'Shell Search Provider';

// const SearchProviderInterface = ByteArray.toString(Gio.resources_lookup_data('/org/gnome/Shell/SearchProvider2', 0).get_data());
const SEARCH_PROVIDER_IFACE = 'org.gnome.Shell.SearchProvider2';
const SEARCH_PROVIDER_PATH = '/net/mwop/VBoxMachines/SearchProvider';
const SearchProviderInterface = '<node> \
  <interface name="org.gnome.Shell.SearchProvider2"> \
    <method name="GetInitialResultSet"> \
      <arg type="as" name="terms" direction="in" /> \
      <arg type="as" name="results" direction="out" /> \
    </method> \
    <method name="GetSubsearchResultSet"> \
      <arg type="as" name="previous_results" direction="in" /> \
      <arg type="as" name="terms" direction="in" /> \
      <arg type="as" name="results" direction="out" /> \
    </method> \
    <method name="GetResultMetas"> \
      <arg type="as" name="identifiers" direction="in" /> \
      <arg type="aa{sv}" name="metas" direction="out" /> \
    </method> \
    <method name="ActivateResult"> \
      <arg type="s" name="identifier" direction="in" /> \
      <arg type="as" name="terms" direction="in" /> \
      <arg type="u" name="timestamp" direction="in" /> \
    </method> \
    <method name="LaunchSearch"> \
      <arg type="as" name="terms" direction="in" /> \
      <arg type="u" name="timestamp" direction="in" /> \
    </method> \
  </interface> \
</node>';

const ShellSearchProvider = class VBoxMachinesSearchProvider {
    constructor() {
        this._impl = Gio.DBusExportedObject.wrapJSObject(SearchProviderInterface, this);
    }

    export(connection) {
        return this._impl.export(connection, SEARCH_PROVIDER_PATH);
    }

    unexport(connection) {
        return this._impl.unexport_from_connection(connection);
    }

    /* Interface methods
     *
     * - GetInitialResultSet(params, invocation): start an initial search
     *   for results from this provider. First item in params is a set of terms
     *   to search against. Should match an array of identifiers; use
     *   `invocation.return_value()` to push them to the shell.
     * - GetSubsearchResultSet(previous, terms): continue searching after
     *   initial typing. "previous" is the previous set of results. Otherwise,
     *   acts like GetInitialResultSetAsync, except returns matched items
     *   directly (not async).
     * - GetResultMetas(identifiers, invocation): return metadata (an object)
     *   for each matched result:
     *   - id: the result id
     *   - name: the display name for the result
     *   - description: optional short description for the result
     *   - icon: a serialized GIcon OR
     *   - gicon: a textual representation of a GIcon OR
     *   - icon-data: a tuple describing a pixbuf
     * - ActivateResult(id, terms, timestamp): Launch the selected search result.
     * - LaunchSearch(terms, timestamp): Launched when user clicks on the provider icon, to
     *   launch the application and display search results.
     */

    getInitialResultSet(params, callback) {
        // log('VMBoxSearch loading initial result set');
        let terms = params[0];
        let results = this._getResultSet(null, terms);
        callback(results);
    }

    getSubsearchResultSet(previous, terms) {
        // log('VMBoxSearch loading subsearch result set');
        return this._getResultSet(previous, terms);
    }
    
    getResultMetas(ids, callback) {
		// log('idsForMeta> ' + JSON.stringify(ids));
        let metas = ids.map((element) => ({
            id:           element.id,
            name:         element.name + " VM",
            description:  element.name + 'VirtualBox VM',
            createIcon:   (size) => {
                let icon = new Gio.ThemedIcon({ names : ['virtualbox', 'computer'] });
                return new St.Icon({ gicon: icon, icon_size: size });
            }
        }));
        callback(metas);
    }
          
    activateResult(id, terms, timestamp) {
        // log('id ' + id + ' terms ' + terms);
        Util.spawn([ 'vboxmanage', 'startvm', id ]);
    }

    launchSearch(terms, timestamp) {
        Util.spawn([ 'virtualbox' ]);
    }

    /**
     * Undocumented required method from gnome-shell
     */
    filterResults(results, max) {
        return results.slice(0, max);
    }
    
    _getResultSet(results, terms) {
		var vms = '';
		
		try {
            var output = GLib.spawn_command_line_sync('vboxmanage list vms');
			vms = ByteArray.toString(output[1]);
		} catch (err) {	
            Main.notifyError("VirtualBox machines launcher: " + err.message);		
			return;
		}

		// log('Terms>' + terms);

		let mainRegExp   = new RegExp('\"(.*' + terms + '.*)" \{.*\}', 'mi');
		let singleRegExp = new RegExp('\{.*\}', 'mi');
		var matches      = null;
		results          = new Array();

		// log('vms>' + vms);

        // multiple matches are not handled by RegEx so this removes the matched
        // value from the original string and loops until matches is not null		
		do {
            matches = mainRegExp.exec(vms);		 
            if (matches != null) {
                // log('partialM> ' + matches[0]); 		          
                vms = vms.substring(vms.indexOf(matches[0])+matches[0].length);
                var vmid = singleRegExp.exec(matches[0]);
                // log('partialM> ' + vmid);
                results.push({ id: String(vmid[0]), name: String(matches[1]) });
            }   
        } while (matches!=null);

		// log('VMResults> ' + JSON.stringify(results));

		return results;
    }
}

let searchProvider = null;

function init() {}

function enable() {
    if (searchProvider) {
        return;
    }

    searchProvider = new ShellSearchProvider();
    Main.overview.viewSelector._searchResults._registerProvider(searchProvider);
}

function disable() {
    if (! searchProvider) {
        return;
    }
    Main.overview.viewSelector._searchResults._unregisterProvider(searchProvider);
    searchProvider = null;
}
