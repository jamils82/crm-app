export const environment = {
  production: false,

  // Dummy/placeholder Facebook App ID — replace with a real App ID from
  // https://developers.facebook.com/apps once the Facebook App is set up.
  // A "Test App" id works fine here too while in development.
  facebookAppId: '2393077271509339', // cfs bedding 2393077271509339
  facebookApiVersion: 'v19.0',

  // Since 2023, Meta requires "Facebook Login for Business" (not classic
  // Facebook Login) to request any Page permission on newly created apps.
  // Create a Login Configuration under:
  //   App Dashboard → Facebook Login for Business → Configurations
  // selecting the pages_show_list / pages_manage_posts / pages_read_engagement
  // permissions (plus instagram_basic + instagram_content_publish for
  // Instagram posting), then paste its numeric Configuration ID here. Leave blank
  // to fall back to the classic scope-based login (works on older apps).
  facebookLoginConfigId: '1641862417382670' // insta config 1641862417382670
};
